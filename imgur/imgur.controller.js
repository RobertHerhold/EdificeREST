'use strict';

const http = require('axios');
const config = require('config');
const jimp = require('jimp');

exports.init = function(router) {
    router.post('/imgur/', uploadImageToImgur);
};

function* uploadImageToImgur() {
    const imgBuffer = new Buffer(this.request.body.image,'base64');

    jimp.read(imgBuffer).then(image => console.log(image))

    this.body = {};

    // const imgurRes = yield http.post('https://api.imgur.com/3/image', this.request.body, {
    //     headers: {
    //         'Authorization': 'Client-ID ' + config.get('imgurClientId')
    //     }
    // });
    //
    // this.status = imgurRes.data.status;
    // this.body = imgurRes.data.data;
}
