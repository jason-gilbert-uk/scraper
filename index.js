const {writeObjectToS3,generateDateTimeFileName} = require('@jasongilbertuk/s3-helper')
const {readConfigFromControlTable,writeItemToControlTable} = require('@jasongilbertuk/control-table')
const {createSQSIfDoesntExist,writeObjectToSQS} = require('@jasongilbertuk/sqs-helper')

const axios = require('axios')
const cheerio = require('cheerio')

var g_config=[];
var g_indexToProcess = 0;
var articles = [];
const PROMOTION_TYPE = {
    NONE: "None",
    MEAL_DEAL: "Meal Deal",
    ANY_X_FOR_Y: "Any x for y",
    PER_KG: "Per Kg",
    CHEAPEST_FREE: "Cheapest Free",
    CLUBCARD_PRICE: "Clubcard Price"
}

function getConfigIndexToProcess() {
    var indexFound = false;
    var index = 0;
    var foundIndex = 0;
    while (!indexFound && index < g_config.length) {
        if (g_config[index].state == 'processing') {
            indexFound = true;
            g_indexToProcess= index;
        } else {
            index++;
        }
    }
    if (!indexFound)  {
        index = 0;
        while (!indexFound && index < g_config.length) {
            if (g_config[index].state == 'ready') {
                indexFound = true;
                g_indexToProcess = index;
            } else {
                index++;
            }
        }
    }
    return indexFound;
}
function sleepWithDelay(delay) {
    console.log('*** sleeping for a period of ',delay," milliseconds")
    var start = new Date().getTime();
    while (new Date().getTime() < start + delay);
}

function randomSleep(lowerms,upperms) {
    const delay =  Math.floor(Math.random() * (upperms - lowerms + 1) + lowerms)
    sleepWithDelay(delay);
}

async function processNextEntry() {
    var url = ""
    if (g_config[g_indexToProcess].state == 'ready') {
        url = g_config[g_indexToProcess].url;
        g_config[g_indexToProcess].state = "processing"
    } else {
        url = g_config[g_indexToProcess].nextInChain;
    }
    randomSleep(500,1000);
    console.log('*** timer complete processing request for url ',url)
    try {
        console.log('axios about to be called. url = ',url)
        var response = await axios.get(url);
    }
    catch (error) {
        console.log('*** received an error requesting url ',url);
        console.log(error);
        var trimmedURL = url.slice(21,url.length);
        return;
    }
    
    try {
        const html = response.data;
        const $ = cheerio.load(html)
        $('.product-list--list-item',html).each(function(){
            var isAvailable = true;
            var title = $(this).find('h3').text()
            var urlsub = $(this).find('a').attr('href');
            var url = "https://www.tesco.com" + urlsub;
            var productId = url.substr(url.lastIndexOf('/') + 1);
            var imageUrl
            var price =  parseFloat("0.00").toFixed(2);
            var AldiPriceMatch = false;
            var hasPromotion = false;
            var ProductPromotionText = ''
            var ProductPromotionDate = ''
            var ProductPromotionStart = ''
            var ProductPromotionEnd = ''
            var clubcardPrice = price;
            var purchaseNumber
            var purchasePrice
            var promotionType = PROMOTION_TYPE.NONE;

            const imageBlock = $(this).find('.product-image__container')
            imageUrl = $(imageBlock.find('img')).attr('src');
            
            const unavailableText = $(this).find('.unavailable-messages').text();
            if (unavailableText != "") {
                isAvailable = false;
                var article = {
                    "productId": productId,
                    "title": title,
                    "url" : url,
                    "imageUrl" : imageUrl,
                    "isAvailable" : isAvailable,
                    "price": price,
                    "aldiPriceMatch" : AldiPriceMatch,
                    "hasPromotion": hasPromotion,
                    "promotionType": promotionType,
                    "productPromotionText": ProductPromotionText,
                    "productPromotionDate": ProductPromotionDate,
                    "productPromotionStart": ProductPromotionStart,
                    "productPromotionEnd" : ProductPromotionEnd,
                    "clubcardPrice": clubcardPrice};
                articles.push(article);
                return true;            //skip to next item in each itteration.
            } 

            const priceEntry = $(this).find('.price-per-sellable-unit--price')
            const textprice = $(priceEntry).find('.value').text()
            price = parseFloat(textprice).toFixed(2);
            clubcardPrice = price;
            const ProductInfoMessages= $(this).find('.product-info-message-list');
            const ProductInfoMessage =$(ProductInfoMessages).find('.product-info-message');
            const AldiPriceMatchMessage = $(ProductInfoMessage).find('p').text();
            if (AldiPriceMatchMessage === "Aldi Price MatchAldi Price Match") {
                AldiPriceMatch = true;
            }
            ProductPromotionText = $(this).find('.offer-text').text();
            ProductPromotionDate = $(this).find('.dates').text();
            ProductPromotionText = ProductPromotionText.slice(0,ProductPromotionText.length/2);
            ProductPromotionDate = ProductPromotionDate.slice(0,ProductPromotionDate.length/2);
            var showDeal = true;
            var temp = ProductPromotionText.indexOf("Cheapest Product Free");
            if (temp == -1)
            {
                temp = ProductPromotionText.indexOf("per kg Clubcard Price")
                if (temp == -1) {
                    temp = ProductPromotionText.indexOf("Meal Deal");
                    if (temp == -1){
                        temp = ProductPromotionText.indexOf("Any ");
                        if (temp == -1)
                        {
                            temp = ProductPromotionText.indexOf("Clubcard Price");
                            if (temp == -1) {
                                promotionType = PROMOTION_TYPE.NONE;
                                clubcardPrice = price;
                            } else if (temp==4) {
                                promotionType = PROMOTION_TYPE.CLUBCARD_PRICE;
                                clubcardPrice = parseFloat("0."+ ProductPromotionText.slice(0,2)).toFixed(2);
                            }else {
                                promotionType = PROMOTION_TYPE.CLUBCARD_PRICE;
                                clubcardPrice = parseFloat(ProductPromotionText.slice(1,temp-1)).toFixed(2);
                            }
                        } else {
                            promotionType = PROMOTION_TYPE.ANY_X_FOR_Y;
                            clubcardPrice = price;
                            temp = ProductPromotionText.indexOf("Clubcard Price");
                            purchaseNumber = ProductPromotionText.substring(4,5);
                            purchasePrice = ProductPromotionText.slice(11,temp-1);
                            clubcardPrice = (parseFloat(purchasePrice) / parseFloat(purchaseNumber)).toFixed(2);
                        }
                    } else {
                        promotionType = PROMOTION_TYPE.MEAL_DEAL
                        clubcardPrice = price;
                        showDeal = false;
                    }
                }
                else
                {
                    promotionType = PROMOTION_TYPE.PER_KG;
                    clubcardPrice = price;
                    showDeal = false;
                }
            } else {
                //Todo Any 3 for 2 Clubcard Price - Cheapest Product Free - Selected Vegetables 80g - 800g
                promotionType = PROMOTION_TYPE.CHEAPEST_FREE;
                clubcardPrice = price;
                showDeal = false;
            }

            //calculate effective discount %
            var effectivePercentageReduction = ((1.00 - (parseFloat(clubcardPrice) / parseFloat(price))).toFixed(2))*100;
            console.log('clubcard price = ',clubcardPrice)
            console.log('price = ',price);
            console.log('effective % reduction = ',effectivePercentageReduction)

            if (ProductPromotionDate != '') {
                ProductPromotionStart = ProductPromotionDate.slice(30,40);
                ProductPromotionEnd = ProductPromotionDate.slice(46,57);
                //Offer valid for delivery from 03/01/2022 until 08/02/2022
            }

            var article = {
                "productId": productId,
                "title": title,
                "url" : url,
                "imageUrl" : imageUrl,
                "isAvaialble" : isAvailable,
                "price": price,
                "aldiPriceMatch" : AldiPriceMatch,
                "hasPromotion": hasPromotion,
                "promotionType": promotionType,
                "productPromotionText": ProductPromotionText,
                "productPromotionDate": ProductPromotionDate,
                "productPromotionStart": ProductPromotionStart,
                "productPromotionEnd" : ProductPromotionEnd,
                "clubcardPrice": clubcardPrice,
                "effectivePercentReduction": effectivePercentageReduction 
            };
            articles.push(article);
            //console.log(JSON.stringify(article)+",");
            
        })
      
        const el = $('.pagination-btn-holder').last();
        var $el = $(el).find('a');
        var att = $el.attr('href');
        if (att == undefined) {
            g_config[g_indexToProcess].state = 'finished';
        } else {
            g_config[g_indexToProcess].nextInChain = "https://www.tesco.com" + att;    
        }

        var item = {id: 'scrapingconfig',  config: {urls: g_config}}
        writeItemToControlTable(g_dbTableName,item)
        return;
    } catch (err) {
        console.log('***CATCH ERROR***')
        console.log('***ERROR: ',err)
    }
}

async function scraper(dbTableName,bucketName,queueName) {
    
    g_dbTableName = dbTableName;
    g_bucketName = bucketName
    g_queueName = await createSQSIfDoesntExist(queueName);

    try {
        var result  = await readConfigFromControlTable(g_dbTableName);
        g_config = result.urls  

        var indexFound = getConfigIndexToProcess();
        while(indexFound) {
            while (articles.length < 500) {
                console.log('articles.length = ',articles.length)
                await processNextEntry()
                indexFound = getConfigIndexToProcess();
            }
            indexFound = false;
            var fileName = generateDateTimeFileName();
            writeObjectToS3(g_bucketName,fileName,articles);
            var sqsMsg = {bucket: g_bucketName,file: fileName};
            writeObjectToSQS(g_queueName,sqsMsg);

            indexFound = getConfigIndexToProcess();
            articles=[];
        }

    } catch (err) {
        console.log('error in scrape: ',err)
    }
}

module.exports = scraper;