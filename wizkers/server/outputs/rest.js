/**
 * This file is part of Wizkers.io
 *
 * The MIT License (MIT)
 *  Copyright (c) 2016 Edouard Lafargue, ed@wizkers.io
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software
 * is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * A REST HTTP Calls output plugin
 *
 * @author Edouard Lafargue, ed@lafargue.name
 */

var querystring = require('querystring'),
    utils = require('../utils.js'),
    dbs = require('../pouch-config'),
    http = require('http'),
    debug = require('debug')('wizkers:output:rest');


module.exports = function rest() {

    var mappings = null;
    var settings = null;
    var post_options = {};
    var regexpath = "";
    var regexargs = "";
    var output_ref = null;

    var matchTempl = function (str, args) {
        return str.replace(/<%=(.*?)%>/g, function (match, field) {
            // the != undefined test is necessary since args[field] can be == 0
            return (args[field] != undefined) ? args[field] : match;
        });
    }

    var decompUrl = function (str) {
        if (str == undefined)
            return false;
        // Straight from RFC 3986 Appendix B
        var decomp = str.match(/(([^:/?#]+):\/\/([^/?#]*))?(([^?#]*)(\?([^#]*))?(#(.*))?)/);
        return {
            proto: decomp[2],
            host: decomp[3],
            path: decomp[5],
            args: decomp[7],
            ref: decomp[9]
        }
    }

    // Load the settings for this plugin
    this.setup = function (output) {

        debug("Setup a new instance");
        mappings = output.mappings;
        settings = output.metadata;
        output_ref = output;

        // Prepare the post options:
        post_options = {
            host: decompUrl(settings.resturl).host,
            port: 80,
            method: (settings.httprequest == "get") ? 'GET' : 'POST',
            // we don't set path here because it is templated
            headers: {
                'X-Datalogger': 'wizkers.io server-mode REST plugin'
            }
        };

        // We test on "!= get" because settings.httprequest can be empty and we want to default
        // to POST
        if (settings.httprequest != "get")
            post_options['headers']['Content-Type'] = 'application/x-www-form-urlencoded';

        regexpath = decompUrl(settings.resturl).path;
        regexargs = decompUrl(settings.resturl).args;

    };

    this.resolveMapping = function (key, data) {
        var m = mappings[key];
        if (typeof m == 'undefined')
            return undefined;
        // Static mappings start with "__"
        if (m.indexOf("__") == 0)
            return m.substr(2);
        return utils.JSONflatten(data)[mappings[key]];
    };



    this.sendData = function (data, idx, isAlarm, cb) {
        var self = this;
        var post_data = '';

        debug("Send data");

        // Step one: prepare the structure
        var fields = {};
        for (var mapping in mappings) {
            fields[mapping] = self.resolveMapping(mapping, data);
        };

        debug('Fields', fields);

        post_options.path = matchTempl(regexpath, fields);
        if (regexargs != undefined)
            post_data = matchTempl(regexargs, fields);

        // If we do a GET, aggregate the path and post_data
        if (post_options.method == "GET") {
            post_options.path = post_options.path + '?' + post_data;
        }

        debug('Post options', post_options);

        output_ref.last = new Date().getTime();
        var post_request = http.request(post_options, function (res) {
            var err = true;
            debug("[REST Output Plugin] REST Request result");
            // this is the xmlhttprequest
            switch (res.statusCode) {
            case 0: // Cannot connect
                output_ref.lastmessage = 'Cannot connect to host';
                break;
            case 200:
            case 201: // success
                output_ref.lastsuccess = new Date().getTime();
                err = false;
                break;
            default:
                break;
            }
            // self.trigger('outputTriggered', { 'name': 'rest', 'error': err, 'message': this.statusText } );
            dbs.outputs.get(output_ref._id, function (err, result) {
                if (err) {
                    debug('Error saving output status', err);
                    debug('Our output ref is', output_ref);
                    return;
                }
                output_ref._rev = result._rev;
                dbs.outputs.put(output_ref, function (err, result) {});
            });

            res.on('data', function (data) {
                debug("API Request result");
                debug(data);
                output_ref.lastmessage = data.toString('utf8');
                dbs.outputs.get(output_ref._id, function (err, result) {
                    if (err) {
                        debug('Error saving output status', err);
                        debug('Our output ref is', output_ref);
                        return;
                    }
                    output_ref._rev = result._rev;
                    dbs.outputs.put(output_ref, function (err, result) {});
                });
                cb(true, idx);
            });

        });
        // We absolutely need to catch errors, otherwise http.request throws
        // them and crashes the server
        post_request.on('error', function (err) {
            output_ref.lastmessage = 'Error:' + err;
            dbs.outputs.get(output_ref._id, function (err, result) {
                if (err) {
                    debug('Error saving output status', err);
                    debug('Our output ref is', output_ref);
                    return;
                }
                output_ref._rev = result._rev;
                dbs.outputs.put(output_ref, function (err, result) {});
            });
            cb(false, idx);
        });

        if (post_options.method == 'POST') {
            post_request.write(post_data);
        }
        post_request.end();
    };
};