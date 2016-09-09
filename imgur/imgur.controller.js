'use strict';

const http = require('axios');
const config = require('config');
const Jimp = require('jimp');

const FULL_WIDTH = 500;
const FULL_HEIGHT = 500;
const imgDataPrefix = 'data:image/png;base64,';

exports.init = function(router) {
    router.post('/imgur/', uploadImageToImgur);
};

function* uploadImageToImgur() {
    const background = new Jimp(FULL_WIDTH, FULL_HEIGHT, 0xbfd1e5ff);

    let image = yield Jimp.read(new Buffer(this.request.body.image, 'base64'));
    image.autocrop();

    let width = image.bitmap.width;
    let height = image.bitmap.height;
    
    if(width > FULL_WIDTH || height > FULL_HEIGHT) {
        image.scaleToFit(FULL_WIDTH, FULL_HEIGHT);
    }
    
    width = image.bitmap.width;
    height = image.bitmap.height;

    background.composite(image, (FULL_WIDTH - width) / 2, (FULL_HEIGHT - height) / 2);

    let base64Img = yield new Promise(function(resolve, reject) {
        background.getBase64(Jimp.MIME_PNG, function(err, res) {
            if (err) {
                return reject(err);
            }
            return resolve(res);
        });
    });

    const imgurRes = yield http.post('https://api.imgur.com/3/image', base64Img.substring(imgDataPrefix.length), {
        headers: {
            'Authorization': 'Client-ID ' + config.get('imgurClientId')
        }
    }).then(res => res.data);

    this.status = imgurRes.status;
    this.body = imgurRes.data;
}
