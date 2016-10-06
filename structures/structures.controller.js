'use strict';

const Boom = require('boom');
const structureSchema = require('./structure.schema');
const helpers = require('../helpers');
const parse = require('co-busboy');
const _ = require('lodash');
const cuid = require('cuid');
const nbt = require('nbt');
const rp = require('request-promise');

let datastore;
let bucket;
const STRUCTURE_COLLECTION_KEY = process.env.NODE_ENV === 'development' ? 'dev_Structure' : 'Structure';

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
    const fileName = structureId + '.schem';

    const remoteWriteStream = bucket.file(fileName).createWriteStream();
    schematicDataStream.pipe(remoteWriteStream);

    // Get some information from the schematic
    let structure = {
        schematic: 'https://storage.googleapis.com/edifice-structures/' + fileName,
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

    /* eslint-disable quotes */
    structure.author = _.get(schematic, "Metadata.value['.'].value.Author.value");
    structure.name = _.get(schematic, "Metadata.value['.'].value.Name.value");
    /* eslint-enable quotes */

    // Save the structure record
    yield new Promise((resolve, reject) => {
        datastore.save({
            key: datastore.key([STRUCTURE_COLLECTION_KEY, structureId]),
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
    const structureId = this.params.id;

    yield new Promise((resolve, reject) => {
        const transaction = datastore.transaction();
        transaction.run(err => {
            if(err) {
                return reject(err);
            }
            
            transaction.get(datastore.key([STRUCTURE_COLLECTION_KEY, structureId]), (err, structure) => {
                if (err) {
                    return reject(err);
                }
                if(!structure) {
                    return reject(Boom.notFound('Structure with ID ' + this.params.id + ' not found.'));
                }
                
                let userValidationProm;
                if(structure.data.finalized) {
                    userValidationProm = helpers.validateUser(this.header.authorization).then(user => {
                        if(user.app_metadata.mcuuid !== structure.data.creatorUUID && !user.app_metadata.roles.includes('admin')) {
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
                    
                    transaction.commit(function(err) {
                        if(err) {
                            return reject(err);
                        }
                        return resolve();
                    });
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
    this.body = this.structure;
}

function* getAllStructures() {
    let searchTerms = {
        'finalized': true
    };
    Object.assign(searchTerms, this.query || {});
    let query = datastore.createQuery(STRUCTURE_COLLECTION_KEY);
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
        structure.id = entry.key.name;
        structures.push(structure);
    }

    this.status = 200;
    this.body = structures;
}

function* getStructure() {
    const res = yield new Promise((resolve, reject) => {
        datastore.get(datastore.key([STRUCTURE_COLLECTION_KEY, this.params.id]), function(err, data) {
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
    structure.id = res.key.name;

    if(this.query.schematic) {
        const schematicUrl = structure.schematic;
        const schematicDataBuffer = yield rp({
            method: 'GET',
            uri: schematicUrl,
            encoding: null
        });

        const jsonData = yield new Promise(function(resolve, reject) {
            nbt.parse(schematicDataBuffer, function(err, data) {
                if(err) {
                    return reject(err);
                }
                return resolve(data);
            });
        });
        cleanupNBT(jsonData);
        structure.schematic = jsonData.value;
    }

    this.status = 200;
    this.body = res.data;
}

function cleanupNBT(obj) {
    for(const key in obj) {
        if(!obj.hasOwnProperty(key)) {
            continue;
        }

        const value = obj[key];
        if(value.type !== undefined && value.value !== undefined) {
            obj[key] = value.value;
        }

        if(typeof obj[key] === 'object' && !(obj[key] instanceof Array)) {
            cleanupNBT(obj[key]);
        }
    }
}
