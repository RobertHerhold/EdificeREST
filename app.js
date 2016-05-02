'use strict';

var koa = require('koa');
var Router = require('koa-router');
var logger = require('winston');
var mongoose = require('./services/MongooseClient');

var app = koa({ name: 'Edifice' });

app.use(require('koa-logger')());
app.use(require('koa-cors')({ methods: ['GET', 'PUT', 'POST', 'DELETE'] }));
app.use(require('koa-static-server')({ rootDir: 'EdificeWeb' }));

// Set up routes
var router = new Router({ prefix: '/api' });
const controllers = ['structures', 'playercache', 'imgur'];
controllers.forEach(function(file) {
    logger.info('Loading controller "' + file + '"...');
    require('./' + file + '/' + file + '.controller').init(router, app);
});

// load the routes
app.use(router.routes());

app.listen(3000);

module.exports = app;
