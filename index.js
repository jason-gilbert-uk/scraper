const {writeObjectToS3,generateDateTimeFileName} = require('@jasongilbertuk/s3-helper')
const {readConfigFromControlTable,writeItemToControlTable} = require('@jasongilbertuk/control-table')
const {createSQSIfDoesntExist,writeObjectToSQS} = require('@jasongilbertuk/sqs-helper')

const axios = require('axios')
const cheerio = require('cheerio')

var g_config=[];
var g_indexToProcess = 0;
var articles = [];

const promotionType = {
    PERCENT_REDUCTION: 'percentage reduction',
    CHEAPEST_PRODUCT_FREE: 'cheapest product free',
    ANY_X_FOR_Y: 'any x for y',
    REDUCED_TO_CLEAR: 'reduced to clear',
    MEAL_DEAL: 'meal deal',
    X_FOR_Y: 'x for y',
    CLUBCARD_PRICE: 'clubcard price',
    BOOK_CLUB: 'book club',
    NO_OFFER: 'no offer',
    UNRECOGNISED: "unrecognised"
}

function logDetails(product) {
    //console.log(product);
    console.log('promotion: ',product.productPromotionText);
    console.log('promition type: ',product.promotionType);
    console.log('quantity to achieve discount: ',product.quantityToAchieveDiscount); 
    console.log('original price: ',product.price);
    console.log('percentage discount: ',product.percentageDiscount)
    console.log('discounted price: ',product.discountedPrice)
}


function processPercentOffer(product) {
    //Buy 2 or more Save 25% Clubcard Price
    product.promotionType = promotionType.PERCENT_REDUCTION;
    const words = product.productPromotionText.split(' ');
    product.quantityToAchieveDiscount = parseInt(words[1]); 
    product.percentageDiscount = parseInt(words[5])
    product.discountedPrice = (parseFloat(product.price) * ((100-product.percentageDiscount)/100));
}

function processCheapestProductFreeOffer(product) {
    //Any 3 for 2 Clubcard Price - Cheapest Product Free - Selected Vegetables 80g - 800g
    product.promotionType = promotionType.CHEAPEST_PRODUCT_FREE;
    const words = product.productPromotionText.split(' ');
    product.quantityToAchieveDiscount = parseInt(words[1]);
    const y = parseInt(words[3]);
    product.percentageDiscount = ((1.00 - (y/product.quantityToAchieveDiscount))*100);
    product.discountedPrice = (parseFloat(product.price)*((100-product.percentageDiscount)/100));
  
}

function processReducedToClearOffer(product) {
    //Reduced to Clear Was £11.00 Now £7.50
    product.promotionType = promotionType.REDUCED_TO_CLEAR;

    const words = product.productPromotionText.split(' ');
    words[4] = words[4].slice(1);   // Remove the £
    words[6] = words[6].slice(1)    // Remove the £
    product.price = parseFloat(words[4])
    product.discountedPrice = parseFloat(words[6])
    product.quantityToAchieveDiscount = 1;
    product.percentageDiscount = ((1.00-(product.discountedPrice / product.price))*100)
}

function processAnyXforYOffer(product) {
    //Any 2 for £1.30 Clubcard Price - Selected Lindt Premium Single Chocolates 35g Or 38g
    product.promotionType = promotionType.ANY_X_FOR_Y;
    
    const words = product.productPromotionText.split(' ');
    if (words[3].indexOf('£') !== -1) {
        words[3] = words[3].slice(1);
    } else if (words[3].indexOf('p')!== -1) {
        words[3] = words[3].slice(0,words[3].length()-1)
    } else {
        console.log('error encountered in processAnyXforYOffer')
        console.log(words)
    }
    product.quantityToAchieveDiscount = parseInt(words[1]);
    totalCost = parseInt(words[3]);
    product.percentageDiscount = ((1.00-((totalCost/product.quantityToAchieveDiscount)/product.price))*100);
    product.discountedPrice = product.price*((100-product.percentageDiscount)/100)
}

function processXforYOffer(product) {
    //4 for £3 or 8 for £5 Clubcard Price - Heinz Soup 400g
    product.promotionType = promotionType.X_FOR_Y;

    const words = product.productPromotionText.split(' ');
    if (words[2].indexOf('£') !== -1) {
        words[2] = words[2].slice(1);
        
    } else if (words[2].indexOf('p')!== -1) {
        words[2] = words[2].slice(0,words[2].length-1)
        words[2] = "0." +words[2]
        
    } else {
        console.log('error')
        console.log(words)
    }
    product.quantityToAchieveDiscount = parseInt(words[0]);
    const totalPrice = parseInt(words[2]);
    product.discountedPrice = totalPrice/product.quantityToAchieveDiscount;
    product.percentageDiscount = (1.00-((product.discountedPrice/parseFloat(product.price))));
}
function processMealDealOffer(product){
    product.promotionType = promotionType.MEAL_DEAL;

    //£3 Meal Deal Clubcard Price £3.50 Meal Deal Regular Price - Selected Drink, Snack, Wrap, Sandwich, Roll, Pasty Or Salad//
    //Currently we ignore meal deal offers.
    product.percentageDiscount = 0;
    product.quantityToAchieveDiscount = 1;
    product.discountedPrice = product.price;
}

function processTescoBookClubOffer(product){
    product.promotionType = promotionType.BOOK_CLUB;
    

    //TESCO BOOK CLUB
    //Currently we ignore Tesco Book Club entries.
    product.percentageDiscount = 0;
    product.quantityToAchieveDiscount = 1;
    product.discountedPrice = product.price;
}

function processClubcardPriceOffer(product){
    //£2.00 Clubcard Price
    product.promotionType = promotionType.CLUBCARD_PRICE;

    const words = product.productPromotionText.split(' ');
    if (words[0].indexOf('£') !== -1) {
        words[0] = words[0].slice(1);
    } else if (words[0].indexOf('p')!== -1) {
        words[0] = words[0].slice(0,words[0].length-1)
        words[0] = "0." +words[0]
        
    } else {
        console.log('error')
        console.log(words)
    }
    const x = parseFloat(words[0]);
    product.percentageDiscount = (1.00-((parseFloat(words[0]/parseFloat(product.price)))));
    product.quantityToAchieveDiscount = 1;
    product.discountedPrice = parseFloat(words[0]);

}

function processNoOffer(product) {
    product.promotionType = promotionType.NO_OFFER;
    product.percentageDiscount = 0;
    product.quantityToAchieveDiscount = 1;
    product.discountedPrice = product.price;


}

function processUnrecognisedOffer(product) {
    product.promotionType = promotionType.UNRECOGNISED;
    product.percentageDiscount = 0;
    product.quantityToAchieveDiscount = 1;
    product.discountedPrice = product.price;

    console.log('error: unrecognised offer type')
    console.log(product);
}




function categorise(product) {
    var category = promotionType.UNRECOGNISED;
    var promotionText = product.productPromotionText;

    if (product.isAvailable == false) {
        //If product is not available, price is not given. Without the price, any promotion
        //discounts can not be calculated. Therefore we set all to default values below.
        
    }
    else if (promotionText==="") {
        category =  promotionType.NO_OFFER;
    }
    else if (promotionText.indexOf("%") !== -1) {
        category =  promotionType.PERCENT_REDUCTION;
    }
    else if (promotionText.indexOf("Cheapest Product Free") !== -1) {
        category =  promotionType.CHEAPEST_PRODUCT_FREE;
    } 
    else if (promotionText.indexOf("Any") !== -1) {
        category =  promotionType.ANY_X_FOR_Y;
    }
    else if (promotionText.indexOf("Reduced to Clear Was") !== -1) {
        category =  promotionType.REDUCED_TO_CLEAR;
    } 
    else if (promotionText.indexOf("Meal Deal") !== -1) {
        category =  promotionType.MEAL_DEAL;
    }
    else if (promotionText.indexOf("for") !== -1) {
        category =  promotionType.X_FOR_Y;  
    }
    else if (promotionText.indexOf("Clubcard Price") !== -1) {
        category =  promotionType.CLUBCARD_PRICE;  
    }
    else if (promotionText.indexOf("TESCO BOOK CLUB") !== -1) {
        category =  promotionType.BOOK_CLUB;       
    }
    else {
        category = promotionType.UNRECOGNISED;
    }

    return category;
}

function processCategory(product) {
    product.category = categorise(product);
    switch (product.category) {
        case promotionType.PERCENT_REDUCTION:
            processPercentOffer(product);
            break;
        case promotionType.CHEAPEST_PRODUCT_FREE:
            processCheapestProductFreeOffer(product);
            break;
        case promotionType.ANY_X_FOR_Y:
            processAnyXforYOffer(product);
            break;
        case promotionType.REDUCED_TO_CLEAR:
            processReducedToClearOffer(product);
            break;
        case promotionType.MEAL_DEAL:
            processMealDealOffer(product);
            break;
        case promotionType.X_FOR_Y:
            processXforYOffer(product);
            break;
        case promotionType.CLUBCARD_PRICE:
            processClubcardPriceOffer(product)
            break;
        case promotionType.BOOK_CLUB:
            processTescoBookClubOffer(product);
            break;
        case promotionType.NO_OFFER:
            processNoOffer(product);
            break;
        case promotionType.UNRECOGNISED:
        default:
            processUnrecognisedOffer(product)
            break;
    }
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
            var price =  parseFloat("0.00");
            if (price === 'NaN') {
                console.log(url)
                console.log('price is not a number')
                throw "Price is not a number"
            }
            var AldiPriceMatch = false;
            var hasPromotion = false;
            var ProductPromotionText = ''
            var ProductPromotionDate = ''
            var ProductPromotionStart = ''
            var ProductPromotionEnd = ''
            var typeOfPromition = promotionType.NO_OFFER;

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
                    "productPromotionText": ProductPromotionText,
                    "productPromotionDate": ProductPromotionDate,
                    "productPromotionStart": ProductPromotionStart,
                    "productPromotionEnd" : ProductPromotionEnd,
                    "promotionType": typeOfPromition,
                    "quantityToAchieveDiscount" : 1,
                    "pecentageDiscount": 0,
                    "discountedPrice" : price
                }

                articles.push(article);
                return true;            //skip to next item in each itteration.
            } 

            const priceEntry = $(this).find('.price-per-sellable-unit--price')
            const textprice = $(priceEntry).find('.value').text()
            price = parseFloat(textprice);
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
                "productPromotionText": ProductPromotionText,
                "productPromotionDate": ProductPromotionDate,
                "productPromotionStart": ProductPromotionStart,
                "productPromotionEnd" : ProductPromotionEnd,
            };
            processCategory(article);
            articles.push(article);
            
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