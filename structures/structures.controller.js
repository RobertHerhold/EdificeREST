'use strict';

const Boom = require('boom');
const structureSchema = require('./structure.schema');
const helpers = require('../helpers');
const _ = require('lodash');
let datastore;
let storage;

exports.init = function(router, app) {
    router.post('/structures', createStructure);
    router.post('/structures/nbt', uploadStructureNBT);
    router.put('/structures/:id', editStructure);
    router.get('/structures', getAllStructures);
    router.get('/structures/:id', getStructure);

    datastore = app.datastore;
    storage = app.storage;
};

function* uploadStructureNBT() {
    console.log(this.request.body);
    const file = yield new Promise(function(resolve, reject) {
        storage.bucket('edifice-structures').upload('test.dat', function(err, file) {
            if(err) {
                return reject(err);
            }
            return resolve(file);
        });
    });
}

function* createStructure() {
    let structure = this.request.body;
    structure.finalized = false;

    const res = yield new Promise((resolve, reject) => {
        datastore.save({
            key: datastore.key('Structure'),
            data: structure
        }, function(err, res) {
            if(err) {
                return reject(err);
            }
            return resolve(res);
        });
    });

    // TODO figure out a better way to get the ID other than this magic path
    structure.id = _.get(res, 'mutationResults[0].key.path[0].id');
    // Remove the blocks to make the response smaller
    delete structure.blocks;

    this.status = 201;
    this.body = structure;
}

function* editStructure() {
    helpers.validateInput(this.request.body, structureSchema.edit.input);

    // the gcloud datastore takes only an int
    const structureId = parseInt(this.params.id);
    if(!structureId) {
        throw Boom.badRequest('Invalid structure ID');
    }

    yield new Promise((resolve, reject) => {
        datastore.runInTransaction((transaction, done) => {
            transaction.get(datastore.key(['Structure', structureId]), (err, structure) => {

                if (err) {
                    done();
                    return reject(err);
                }
                if(!structure) {
                    done();
                    return reject(Boom.notFound('Structure with ID ' + this.params.id + ' not found.'));
                }

                let userValidationProm;
                if(structure.data.finalized) {
                    userValidationProm = helpers.validateUser(this.header.authorization).then(user => {
                        if(user.app_metadata.mcuuid !== structure.data.creatorUUID && !user.app_metadata.roles.includes('admin')) {
                            done();
                            return reject(Boom.unauthorized());
                        }
                    });
                } else {
                    // The user doesn't need to be validated for the first edit/finalization
                    // The user having the structure ID is enough identification
                    structure.data.finalized = true;
                    userValidationProm = Promise.resolve();
                }

                userValidationProm.then(() => {
                    _.merge(structure.data, this.request.body);
                    structure.data.stargazers = [];
                    transaction.save(structure);

                    // Keep a reference around for including in the response
                    this.structure = structure.data;
                    return done();
                });

            });
        }, function(transactionError) {
            if (transactionError) {
                return reject(transactionError);
            }
            return resolve();
        });
    }).catch(err => {
        if(err.isBoom) {
            throw err;
        }
    });

    this.status = 200;
    // Delete blocks from the response
    delete this.structure.blocks;
    this.body = this.structure;
}

function* getAllStructures() {
    let searchTerms = {
        'finalized': true
    };
    Object.assign(searchTerms, this.query || {});
    let query = datastore.createQuery('Structure');
    for(const condition in searchTerms) {
        query = query.filter(condition, '=', searchTerms[condition]);
    }

    const res = yield new Promise((resolve, reject) => {
        datastore.runQuery(query, function(err, data) {
            if(err) {
                return reject(err);
            }
            return resolve(data);
        });
    });

    let structures = [];

    for(const entry of res) {
        const structure = entry.data;
        delete structure.blocks;
        structure.id = entry.key.id;
        structures.push(structure);
    }

    this.status = 200;
    this.body = structures;
}

function* getStructure() {
    // the gcloud datastore takes only an int
    const structureId = parseInt(this.params.id);
    if(!structureId) {
        throw Boom.badRequest('Invalid structure ID');
    }

    const res = yield new Promise(function(resolve, reject) {
        datastore.get(datastore.key(['Structure', structureId]), function(err, data) {
            if(err) {
                return reject(err);
            }
            return resolve(data);
        });
    });

    if(!res) {
        throw new Boom.notFound('Structure with ID ' + this.params.id + ' not found.');
    }

    let structure = res.data;
    structure.id = res.key.id;

    this.status = 200;
    this.body = res.data;
}
