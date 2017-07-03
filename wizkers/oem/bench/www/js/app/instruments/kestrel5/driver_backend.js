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


// This detects whether we are in a server situation and act accordingly:
if (typeof define !== 'function') {
    var define = require('amdefine')(module);
    var vizapp = { type: 'server'},
    DataView = require('buffer-dataview'), // Important for compatibility
    events = require('events'),
    dbs = require('pouch-config');
}

define(function (require) {
    "use strict";

    var Serialport = require('serialport'), // Used for parsing only
        abutils = require('app/lib/abutils'),
        btleConnection = require('connections/btle');


    var parser = function (socket) {

        var self = this,
            socket = socket,
            streaming = true,
            port = null,
            port_close_requested = false,
            port_open_requested = false,
            isopen = false;

        // We have to have those in lowercase
        var KESTREL_SERVICE_UUID  = '03290000-eab4-dea1-b24e-44ec023874db';
        var WX1_UUID     = '03290310-eab4-dea1-b24e-44ec023874db';
        var WX2_UUID     = '03290320-eab4-dea1-b24e-44ec023874db';

        // small utility to convert DDMM.MMM or DDDMM.MMM to decimal
        var parseDecDeg = function (c, hemi) {
            var i = c.indexOf('.');
            var deg = c.substring(0, i - 2);
            var decMin = c.substring(i - 2, c.length - 1);
            var decDeg = parseInt(deg, 10) + (decMin / 60);
            if (hemi === 'W' || hemi === 'S')
                decDeg *= -1;
            return decDeg;
        };


        /////////////
        // Private methods
        /////////////

        var portSettings = function () {
            return {
                service_uuid: KESTREL_SERVICE_UUID,
                characteristic_uuid: WX1_UUID
            }
        };

        // Format can act on incoming data from the device, and then
        // forwards the data to the app through a 'data' event.
        var format = function (data) {
            if (!data.value) {
                debug('No value received');
                return;
            }
            var dv = new DataView(data.value);
            var temp = dv.getInt16(2, true);

            var jsresp = {
                temperature: temp/100,
                unit: {
                    temperature: 'celsius',
                }
            };

            debug(jsresp);
            self.trigger('data', jsresp);


        };

        // Status returns an object that is concatenated with the
        // global server status
        var status = function (stat) {
            port_open_requested = false;
            console.log('Port status change', stat);
            if (stat.openerror) {
                // We could not open the port: warn through
                // a 'data' messages
                var resp = {
                    openerror: true
                };
                if (stat.reason != undefined)
                    resp.reason = stat.reason;
                if (stat.description != undefined)
                    resp.description = stat.description;
                self.trigger('data', resp);
                return;
            }
            if (stat.reconnecting != undefined) {
                // Forward the message to front-end
                self.trigger('data', {reconnecting:stat.reconnecting});
                return;
            }
            isopen = stat.portopen;
            if (isopen && stat.services) {
                // Should run any "onOpen" initialization routine here if
                // necessary.
                console.log('We found those services', stat.services);
                // ToDo: depending on the services we found, we can subscribe
                // to different service/characteristic UUIDs so that we can support
                // multiple versions of the Bluetooth module.
                var s_uuid = KESTREL_SERVICE_UUID,
                    c_uuid = WX1_UUID;
                port.subscribe({
                    service_uuid: s_uuid,
                    characteristic_uuid: c_uuid
                });
            } else {
                // We remove the listener so that the serial port can be GC'ed
                if (port_close_requested) {
                    if (port.off)
                        port.off('status', status);
                    else
                        port.removeListener('status', status);

                    port_close_requested = false;
                }
            }
        };

        var openPort_app = function (insid) {
            port_open_requested = true;
            var ins = instrumentManager.getInstrument();
            port = new btleConnection(ins.get('port'), portSettings());
            port.open();
            port.on('data', format);
            port.on('status', status);
        };

        var openPort_server = function(insid) {
            dbs.instruments.get(insid, function(err,item) {
                port = new btleConnection(item.port, portSettings());
                port.on('data', format);
                port.on('status', status);
                port.open();
            });
        };

        /////////////
        // Public methods
        /////////////

        this.openPort = function (insid) {
            port_open_requested = true;
            if (vizapp.type == 'server') {
                openPort_server(insid);
            } else {
                openPort_app(insid);
            }
        };


        this.closePort = function (data) {
            // We need to remove all listeners otherwise the serial port
            // will never be GC'ed
            if (port.off)
                port.off('data', format);
            else
                port.removeListener('data', format);
            port_close_requested = true;
            port.close();
        }

        this.isOpen = function () {
            return isopen;
        }

        this.isOpenPending = function () {
            return port_open_requested;
        }

        this.getInstrumentId = function (arg) {};

        this.isStreaming = function () {
            return streaming;
        };

        // Called when the app needs a unique identifier.
        // this is a standardized call across all drivers.
        //
        // TODO: Returns the instrument GUID.
        this.sendUniqueID = function () {};

        // period in seconds
        this.startLiveStream = function (period) {};

        this.stopLiveStream = function (args) {};

        // output should return a string, and is used to format
        // the data that is sent on the serial port, coming from the
        // HTML interface.
        this.output = function (data) {
            //console.log('TX', data);
            port.write(data);
        };

        /**
         *This is called by the serial parser (see 'format' above)
         * For some mysterious reason, the bGeigie outputs an NMEA-like
         * sentence, which is very 90's like, but mostly a pain.
         *
         * The Safecast API wants this NMEA data, so we will keep it intact
         * in our own database for easy log export, but add a JSON copy for
         * ease of use for a couple of fields.
         */
        this.onDataReady = function (data) {
            // Remove any carriage return
            data = data.replace('\r\n', '');
            var fields = data.split(',');
            if (fields[0] != '$BNRDD') {
                console.log('Unknown bGeigie sentence');
                self.trigger('data', { error: "Err. Data" });
                return;
            }

            // Since we have a checksum, check it
            var chk = 0;
            for (var i = 1; i < data.indexOf('*'); i++) {
                chk = chk ^ data.charCodeAt(i);
            }
            var sum = parseInt(data.substr(data.indexOf('*')+1), 16);
            if ( chk != sum) {
                self.trigger('data', { error: "Err. Checksum" });
                return;
            }


            var cpm = parseInt(fields[3]);
            var lat = parseDecDeg(fields[7], fields[8]);
            var lng = parseDecDeg(fields[9], fields[10]);
            var sats = parseInt(fields[13]);

            var response = {
                cpm: {
                    value: cpm,
                    count: parseInt(fields[5]),
                    usv: cpm * conversionCoefficient,
                    valid: fields[6] == 'A'
                },
                nmea: data,
                batt_ok: false,
                loc: {
                    coords: {
                        latitude: lat,
                        longitude: lng
                    },
                    sats: sats
                },
                loc_status: (fields[12] == 'A') ? 'OK' : 'No GPS Lock'
            };

            self.trigger('data', response);
        };
    }

    // On server side, we use the Node eventing system, whereas on the
    // browser/app side, we use Bacbone's API:
    if (vizapp.type != 'server') {
        // Add event management to our parser, from the Backbone.Events class:
        _.extend(parser.prototype, Backbone.Events);
    } else {
        parser.prototype.__proto__ = events.EventEmitter.prototype;
        parser.prototype.trigger = parser.prototype.emit;
    }
    return parser;
});