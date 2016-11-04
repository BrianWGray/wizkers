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

/*
 * Browser-side Parser for Yaesu 817/857 radios.
 *
 *
 * TThis code is also used by NodeJS when running
 * in server mode
 *
 *  @author Edouard Lafargue, ed@lafargue.name
 */

if (typeof define !== 'function') {
    var define = require('amdefine')(module);
    var vizapp = { type: 'server'},
    events = require('events'),
    dbs = require('pouch-config');
}

define(function (require) {
    "use strict";

    var Serialport = require('serialport'),
        serialConnection = require('connections/serial'),
        tcpConnection = require('connections/tcp'),
        btConnection = require('connections/btspp'),
        abu = require('app/lib/abutils');

    // Server mode does not support remote protocol (not really needed)
    if (vizapp.type != 'server')
        var Protocol = require('app/lib/jsonbin');


    var parser = function (socket) {

        var socket = socket,
            self = this;
        var serialport = null;
        var livePoller = null; // Reference to the live streaming poller
        var streaming = false,
            port = null,
            proto = 0,
            port_close_requested = false,
            port_open_requested = true,
            isopen = false;

        var radio_modes =      [ "LSB", "USB", "CW", "CWR", "AM", "WFM", "FM", "DIG", "PKT", "???" ];
        var radio_mode_codes = [  0x00,  0x01, 0x02,  0x03, 0x04,  0x06, 0x08,  0x0A,  0x0C ];
        var inputBuffer = new Uint8Array(100); // We usually get fewer than 5 bytes...
        var ibIdx = 0;
        var bytes_expected = 0;
        var watchDog = null;
        var radio_on = true;
        var vfo_freq = 0; // Keep track and only send updates when it changes
        var radio_mode = '';

        // We need to manage a command queue, because we
        // cannot tell what the data in means if we don't know
        // the command that was sent. The joys of async programming.
        var commandQueue = [],
            queue_busy = false;

        // Keep track of TX/RX state so that we can adjust the
        // status command
        var tx_status = false;

        /////////////
        // Private methods
        /////////////

        var portSettings = function () {
            return {
                baudRate: 4800,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                dtr: false,
                flowControl: false,
                // We get non-printable characters on some outputs, so
                // we have to make sure we use "binary" encoding below,
                // otherwise the parser will assume Unicode and mess up the
                // values.
                parser: Serialport.parsers.raw,
            }
        };

        // Format can act on incoming data from the radio, and then
        // forwards the data to the app through a 'data' event.
        //
        // data is an ArrayBuffer;
        var format = function (data) {

            if (proto) {
                // We are using the Wizkers Netlink protocol, so incoming data has to be forwarded
                // to our protocol handler and we stop processing there, the actual data will come in
                // throuth the onProtoData callback (see below)
                proto.read(data);
                return;
            }

            if (commandQueue.length == 0) {
                console.warn('Received data but we didn\'t expect anything', new Uint8Array(data));
                queue_busy = false;
                return;
            }

            inputBuffer.set(new Uint8Array(data), ibIdx);
            ibIdx += data.byteLength;

            if (ibIdx < bytes_expected) {
                // console.info('Still expecting more bytes in the response');
                return;
            }

            clearTimeout(watchDog);

            if (!queue_busy) {
                console.error('We received a complete data packet but we don\'t have the queue_busy flag set');
                return;
            }
            //console.info('Ready to process packet');

            // We can reset our buffer index now...
            ibIdx = 0;
            bytes_expected = 0;

            // At this stage, we know we're expecting a value
            var cmd = commandQueue.shift();
            queue_busy = false;
            var resp = {};

            switch (cmd.command) {
                case 'txrx_status':
                    if (tx_status) {
                        if ( inputBuffer[0] == 0xff) {
                            tx_status = false;
                            break;
                        }
                        resp.pwr = inputBuffer[0] & 0xf;
                        // Somehow the PTT bit always remains at zero ??
                        // resp.ptt =   (inputBuffer[0] & 0x80) != 0;
                        resp.hi_swr = (inputBuffer[0] & 0x40) != 0;
                        resp.split =  (inputBuffer[0] & 0x20) != 0;
                    } else {
                        // Detect if we are in TX mode: inputBuffer = 255
                        if ( inputBuffer[0] == 0xff) {
                            tx_status = true;
                            break;
                        }
                        resp.smeter = inputBuffer[0] & 0xf;
                        resp.squelch = (inputBuffer[0] & 0x80) != 0;
                        resp.pl_code = (inputBuffer[0] & 0x40) != 0;
                        resp.discr   = (inputBuffer[0] & 0x20) != 0;
                    }
                    resp.ptt = tx_status;
                    // console.log(tx_status, resp);
                    break;
                case 'get_frequency':
                case 'poll_frequency':
                    var f = bcd2number(inputBuffer, 4) * 10;
                    // Note: on the FT817ND I used for my tests, the packet mode
                    // actually returns 0xFC for packet, hence the & 0x0f below.
                    var idx = radio_mode_codes.indexOf(inputBuffer[4] & 0x0f);
                    var m = radio_modes[(idx == -1) ? radio_modes.length - 1 : idx];
                    if (f != vfo_freq) {
                        resp.vfoa = bcd2number(inputBuffer, 4) * 10;
                        vfo_freq = f;
                    }
                    if (m != radio_mode) {
                        resp.mode = m;
                    }
                    break;
                case 'lock':
                    resp.locked = inputBuffer[0];
                    break;
                case 'get_active_vfo':
                    resp.active_vfo = (inputBuffer[0] & 0x01) ? 'b' : 'a';
                    break;
            }
            if (Object.keys(resp).length > 0) {
                self.trigger('data', resp);
            }
            processQueue();
        };

        /**
         * Transform a BCD-coded hex buffer into a decimal number
         * len is the number of bytes
         */
        var bcd2number = function(data, len) {
            var f = 0;
            for (var i = 0; i < len; i++) {
                f *= 10;
                f += data[i] >> 4;
                f *= 10;
                f += data[i] & 0xf;
            }
            return f;
        }

        /**
         * Transform an integer number into hex-coded BCD bytes.
         * The number must fit on 4 bytes, hence be lower than 1 million.
         */
        var number2bcd = function(num) {
            if (typeof num != "number" || num > 10e7)
                return [ 0,0,0,0];
            var b = [];
            var s = ("00000000" + num.toString()).slice(-8);
            for (var i=0; i < 4; i++) {
                b[i] = ((s.charCodeAt(i*2)-48) << 4) + (s.charCodeAt(i*2+1)-48);
            }
            return b;
        }

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

            isopen = stat.portopen;

            if (isopen) {
                // Should run any "onOpen" initialization routine here if
                // necessary.
            } else {
                // We remove the listener so that the serial port can be GC'ed
                if (port_close_requested) {
                    if (port.off)
                        port.off('status', stat);
                    else
                        port.removeListener('status', status);
                    port_close_requested = false;
                }
            }
        };


        function queryRadio() {
            // TODO: follow radio state over here, so that we only query power
            // when the radio transmits, makes much more sense

            // This is queried every second - we stage our queries in order
            // to avoid overloading the radio, not sure that is totally necessary, but
            // it won't hurt

            // port.write('');
            // Go a Get_frequency and read VFO eeprom value to know if we are
            // on VFO A or VFO B.
            this.output({ command: 'poll_frequency' });
            this.output({ command: 'txrx_status'});
            // this.output({ command: 'tx_metering'});
            this.output({ command: 'get_active_vfo'});

        };

        // Process the latest command in the queue
        var processQueue = function() {
            if (queue_busy || bytes_expected || (commandQueue.length == 0))
                return;
            queue_busy = true;
            var cmd = commandQueue[0]; // Get the oldest command
            // console.log(cmd);
            // Note: UInt8Arrays are initialized at zero
            var bytes = new Uint8Array(5); // All FT817 commands are 5 bytes long
            switch(cmd.command) {
                case 'set_frequency':
                    var b;
                    if (typeof cmd.arg == 'string') {
                        cmd.arg = Math.floor(parseInt(cmd.arg)/10);
                        b = number2bcd(cmd.arg);
                    } else {
                        b = number2bcd(cmd.arg*1e5);
                    }
                    for (var i=0; i < 4; i++) {
                        bytes[i] = b[i];
                    }
                    bytes[4] = 0x01;
                    commandQueue.shift(); // No response from the radio
                    queue_busy = false;
                    break;
                case 'get_frequency':
                    vfo_freq = 0;
                case 'poll_frequency':
                    bytes[4] = 0x03;
                    bytes_expected = 5;
                    break;
                case 'tx_metering':
                    bytes[4] = 0xbd;
                    bytes_expected = 2;
                    break;
                case 'lock':
                    bytes[4] = (cmd.arg) ? 0x00 : 0x80;
                    bytes_expected = 1; // Radio returns 0x0 if it was unlocked, 0xf if it was locked
                                        // before the command.
                    break;
                case 'ptt':
                    bytes[4] = (cmd.arg) ? 0x08 : 0x88;
                    // tx_status is automatically updated:
                    // tx_status = cmd.arg;
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'clar':
                    bytes[4] = (cmd.arg) ? 0x05 : 0x85;
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'get_active_vfo':
                    // We can read the active VFO from the
                    // eeprom
                    bytes[1] = 0x55;
                    bytes[4] = 0xbb;
                    bytes_expected = 2;
                    break;
                case 'toggle_vfo':
                    bytes[4] = 0x81;
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'split':
                    bytes[4] = (cmd.arg) ? 0x02 : 0x82;
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'power':
                    bytes[4] = (cmd.arg) ? 0x0f : 0x8f;
                    radio_on = cmd.arg;
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'set_mode':
                    bytes[4] = 0x07;
                    var idx = radio_modes.indexOf(cmd.arg);
                    if (idx == -1 ) {
                        console.warn('Invalid mode selected, defaulting to LSB')
                        idx = 0;
                    }
                    bytes[0] = radio_mode_codes[idx];
                    commandQueue.shift();
                    queue_busy = false;
                    break;
                case 'txrx_status':
                    // tx_status = true if we are transmitting
                    bytes[4] = (tx_status) ? 0xf7 : 0xe7;
                    bytes_expected = 1;
                    break;
            }

            if (bytes_expected) {
                watchDog = setTimeout( function() {
                    commandQueue.shift();
                    queue_busy = 0;
                    bytes_expected = 0;
                }, 500);
            };
            port.write(bytes);
        }

        var openPort_server = function(insid) {
            dbs.instruments.get(insid, function(err,item) {
                port = new serialConnection(item.port, portSettings());
                port.on('data', format);
                port.on('status', status);
                port.open();
            });
        };

        var openPort_app = function(insid) {
            var ins = instrumentManager.getInstrument();
            // We now support serial over TCP/IP sockets: if we detect
            // that the port is "TCP/IP", then create the right type of
            // tcp port:
            var p = ins.get('port');
            if (p == 'TCP/IP') {
                // Note: we just use the parser info from portSettings()
                port = new tcpConnection(ins.get('tcpip'), portSettings().parser);
            } else if (p == 'Wizkers Netlink') {
                port = new tcpConnection(ins.get('netlink'), portSettings().parser);
                proto = new Protocol();
                proto.on('data', onProtoData);
            } else if (p == 'Bluetooth') {
                port = new btConnection(ins.get('btspp'), portSettings().parser);
            } else {
                port = new serialConnection(ins.get('port'), portSettings());
            }
            port.on('data', format);
            port.on('status', status);
            port.open();
        }

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

            // If we are streaming, stop it!
            // The Home view does this explicitely, but if we switch
            // instrument while it is open, then it's up to the driver to do it.
            if (streaming)
                this.stopLiveStream();

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
        }

        // Called when the app needs a unique identifier.
        // this is a standardized call across all drivers.
        //
        // Returns the Radio serial number.
        this.sendUniqueID = function () {
            this.uidrequested = true;
            try {
                port.write('');
            } catch (err) {
                console.log("Error on serial port while requesting  UID : " + err);
            }
        };

        // period in seconds
        this.startLiveStream = function (period) {
            var self = this;
            if (proto) {
                // We are connected to a remote Wizkers instance using Netlink,
                // and that remote instance is in charge of doing the Live Streaming
                streaming = true;
                // We push this as a data message so that our output plugins (Netlink in particular)
                // can forward this message to the remote side. In the case of Netlink (remote control),
                // this enables the remote end to start streaming since it's their job, not ours.
                port.write("@N3TL1NK,start_stream;");
                return;
            }
            if (!streaming) {
                console.log("[FT817-ND] Starting live data stream");
                livePoller = setInterval(queryRadio.bind(this), (period) ? period * 1000 : 1000);
                streaming = true;
            }
        };

        this.stopLiveStream = function (args) {
            if (proto) {
                streaming = false;
                port.write("@N3TL1NK,stop_stream;");
                return;
            }
            if (streaming) {
                console.log("[FT817-ND] Stopping live data stream");
                // Stop live streaming from the radio:
                port.write('');
                clearInterval(livePoller);
                streaming = false;
            }
        };

        // Outputs receives the commands from the upper level driver
        // Data should be a JSON object:
        // { command: String, args: any};
        // Command can be:
        //  get_frequency   :
        //  poll_frequency  : same as get, except that if frequency
        //                    didn't change, won't send an update
        //  set_frequency   : number in MHz or number string in Hz.
        //  get_active_vfo  :
        //  lock            : boolean (on/off)
        //  ptt             : boolean (on/off)
        //  set_mode      : String (set operating mode)
        //  clar            : boolean (on/off)
        //  set_clar_freq   : number
        //  toggle_vfo
        //  split           : boolean (on/off)
        //  rpt_offset_dir  : Number ( 1, -1 or zero)
        //  rpt_offset_freq : Number
        //  pl_mode         : String  (DCS/CTCSS mode)
        //  pl_tone         : Number
        //  dcs_code        : NUmber
        //  txrx_status
        //  power           : boolean (on/off)
        this.output = function (data) {
            if (typeof data != 'object') {
                if (data.indexOf("@N3TL1NK,start_stream;") > -1) {
                    this.startLiveStream();
                    return;
                } else if (data.indexOf("@N3TL1NK,stop_stream;") > -1) {
                    this.stopLiveStream();
                    return;
                }
                return;
            }
            if (data.command == undefined) {
                console.error('[ft817 output] Missing command key in output command');
                return;
            }
            if (!radio_on && data.command != 'power') {
                console.warn('[ft817 output] Discarding command because radio is off')
                return;
            }
            commandQueue.push(data);
            processQueue();
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