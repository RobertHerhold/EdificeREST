'use strict';

let Boom = require('boom');
const helpers = require('../../helpers');
let rp = require('request-promise');
let config = require('config');
const _ = require('lodash');
let signupSchema = require('./signup.schema');
let datastore;

let auth0rp = rp.defaults({
    headers: {
        'Authorization': `Bearer ${config.get('auth0Token')}`
    },
    simple: false,
    resolveWithFullResponse: true,
    json: true
});

exports.init = function(router, app) {
    router.post('/auth/signup', signup);

    datastore = app.datastore;
};

function* signup() {
    helpers.validateInput(this.request.body, signupSchema.input);

    // Validate verification code
    const existingCodes = yield new Promise((resolve, reject) => {
        datastore.createQuery('VerificationCode')
            .filter('code', '=', this.request.body.verificationCode)
            .limit(1)
            .run(function(err, data) {
                if(err) {
                    return reject(err);
                }
                return resolve(data);
            });
    });

    const verificationCode = _.get(existingCodes, '[0].data');

    if(!verificationCode) {
        throw Boom.badRequest('Invalid verification code.');
    }

    if(verificationCode.isExpired()) {
        throw Boom.badRequest('Expired verification code.');
    }

    let response = yield auth0rp({
        method: 'POST',
        uri: 'https://edifice.auth0.com/api/v2/users',
        body: {
            connection: 'Username-Password-Authentication',
            email: this.request.body.email,
            password: this.request.body.password,
            app_metadata: {
                mcuuid: verificationCode.playerId
            },
            picture: `https://crafatar.com/avatars/${verificationCode.playerId}`,
            email_verified: false
        }
    });

    if(response.statusCode !== 201) {
        throw Boom.create(response.statusCode, response.body.message);
    }

    yield new Promise((resolve, reject) => {
        datastore.runInTransaction((transaction, done) => {
            transaction.delete(datastore.key(['VerificationCode', verificationCode.id]));
            done();
        }, function(transactionError) {
            if (transactionError) {
                return reject(transactionError);
            }
            return resolve();
        });
    });

    this.status = 201;
    this.body = response.body;
}
