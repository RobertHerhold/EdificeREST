'use strict';

const Boom = require('boom');
const structureSchema = require('./structure.schema');
const helpers = require('../helpers');
const parse = require('co-busboy');
const _ = require('lodash');
const cuid = require('cuid');
const nbt = require('nbt');
let datastore;
let bucket;

exports.init = function(router, app) {
    router.post('/structures', createStructure);
    router.put('/structures/:id', editStructure);
    router.get('/structures', getAllStructures);
    router.get('/structures/:id', getStructure);

    datastore = app.datastore;
    bucket = app.storage.bucket('edifice-structures');
};

function* createStructure() {
    const parts = parse(this);
    const schematicDataStream = yield parts;
    
    // Upload the schematic
    const structureId = cuid();
    const fileName = structureId + '.schematic';
    
    const remoteWriteStream = bucket.file(fileName).createWriteStream();
    schematicDataStream.pipe(remoteWriteStream);
    
    // Get some information from the schematic
    let structure = {
        schematic: 'https://storage.cloud.google.com/edifice-structures/' + fileName,
        finalized: false
    };
    
    const schematicDataBuffer = yield new Promise(function(resolve) {
        let data = [];
        schematicDataStream.on('data', chunk => data.push(chunk));
        schematicDataStream.on('end', () => resolve(Buffer.concat(data)));
    });
    
    const schematic = (yield new Promise(function(resolve, reject) {
        nbt.parse(schematicDataBuffer, function(err, data) {
            if(err) {
                return reject(err);
            }
            return resolve(data);
        });
    })).value;
    
    structure.author = _.get(schematic, "Metadata.value['.'].value.Author.value");
    structure.name = _.get(schematic, "Metadata.value['.'].value.Name.value");
    
    // Save the structure record
    yield new Promise((resolve, reject) => {
        datastore.save({
            key: datastore.key(['Structure', structureId]),
            data: structure
        }, function(err, res) {
            if(err) {
                return reject(err);
            }
            return resolve(res);
        });
    });
    
    structure.id = structureId;

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
    const res = yield new Promise((resolve, reject) => {
        datastore.get(datastore.key(['Structure', this.params.id]), function(err, data) {
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
