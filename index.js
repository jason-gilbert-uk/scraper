const AWS = require('aws-sdk')

function getDateTimeFileName() {
    const date = new Date();
    const year = date.getFullYear() * 1e4; // 1e4 gives us the the other digits to be filled later, so 20210000.
    const month = (date.getMonth() + 1) * 100; // months are numbered 0-11 in JavaScript, * 100 to move two digits to the left. 20210011 => 20211100
    const day = date.getDate(); // 20211100 => 20211124
    const result = year + month + day + '' // `+ ''` to convert to string from number, 20211124 => "20211124"

    var hours = date.getHours()
    var minutes = date.getMinutes()
    var seconds = date.getSeconds();
    if (hours < 10) {
        hours = "0"+hours;
    }
    if (minutes < 10) {
        minutes = "0"+minutes
    }
    if (seconds < 10) {
        seconds = "0"+seconds
    }

    var nameOfFile = result +"-"+hours+minutes+seconds+".json";
    return nameOfFile;
}

async function putObjectToS3(s3BucketName,obj) {
    const fileName = getDateTimeFileName();
    
    var s3 = new AWS.S3();
    var params = {
        Bucket : s3BucketName,
        Key : fileName,
        Body : JSON.stringify(obj)
    }
    try {
        var result = await s3.putObject(params).promise();
        return {bucket: s3BucketName,file: fileName};

    } catch (err) {
        console.log('error on s3 write : ',err)
    }
}

exports.putObjectToS3 = putObjectToS3