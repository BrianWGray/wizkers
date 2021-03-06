/**
 * This file is part of Wizkers.io
 *
 * The MIT License (MIT) with extension
 *  Copyright (c) 2016 Edouard Lafargue, ed@wizkers.io
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the Software
 * is furnished to do so, subject to the following conditions:
 *
 * 1. The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * 2. All Kestrel® communication protocol commands are used under license from
 * Nielsen-Kellerman Co. Do not use for any purpose other than connecting a
 * Kestrel® instrument to the Wizkers framework without permission.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
 * IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */


/**
 *  Link protocol library for Kestrel devices
 */


// This detects whether we are in a server situation and act accordingly:
if (typeof define !== 'function') {
    var define = require('amdefine')(module);
    var vizapp = { type: 'server'},
    // DataView = require('buffer-dataview'), // Important for compatibility
    events = require('events'),
    dbs = require('pouch-config');
}

define(function (require) {
    "use strict";

    var abutils = require('app/lib/abutils'),
        utils = require('app/utils'),
        crcCalc = require('app/lib/crc_calc');

    var linkProtocol = function (driver) {

        var self = this;

        // Binary buffer handling:
        var P_SYNC = 0;
        var P_IDLE = 3;
        var currentProtoState = P_IDLE; // see protostate above
        var inputBuffer = new Uint8Array(512); //  never sends more than 256 bytes
        var ibIdx = 0;
        var acked_cmd = -1; // Command that was last ACK'ed
        var packetList = [];   // All packets ready for processing


        // Right now we assume a Kestrel 5500
        var CMD_GET_DATA_SNAPSHOT = 0,
            CMD_GET_LOG_COUNT_AT  =  3,
            CMD_GET_LOG_DATA_AT   =  5,
            CMD_GET_SERIAL_NUMBER =  6,
            CMD_END_OF_DATA       = 18,
            CMD_TOTAL_RECORDS_WRITTEN = 0x38;

        // Link level packets
        var PKT_COMMAND       =  0,
        PKT_METADATA      =  1,
        PKT_METADATA_CONT =  2,
        PKT_DATA          =  3,
        PKT_ACK           =  4,
        PKT_NACK          =  5;

        // All data types we can find in a log:
        var log_field_names = [
            'timestamp',
            'battery_percent',
            'temperature',
            'wetbulb',
            '6in_globe_temperature',
            'rel_humidity',
            'barometer',
            'altitude',
            'pressure',
            'windspeed',
            'heat_index',
            'dew_point',
            'moisture_content',
            'humidity_ratio',
            'dens_altitude',
            'rel_air_density',
            'airflow',
            'reserved',
            'air_speed',
            'empty',
            'crosswind',
            'evaporation_rate',
            'headwind',
            'compass_mag',
            'naturally_aspired_wetbulb',
            'compass_true',
            'thermal_work_limit',
            'wetbulb_globe_temperature',
            'wind_chill',
            'delta_t',
            'air_density',
            '1in_globe_temperature',
            'humidity_temperature',
            'humidity_thermistor_temperature',
            'average_normal_force',
            'relative_work_per_stroke',
            'empty'
        ];

        var monthNames = [ "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December"];

        /**
         *  Turn a log entry date blob into a Javascript date object
         *  Called from a 'apply' call where 'this' is the dataview
         * @param {*Uint8Array} buffer
         */
        var parseLogDate = function(idx) {
            var ss = this.getUint8(idx++);
            var mm = this.getUint8(idx++);
            var hh = this.getUint8(idx++);
            var dd = this.getUint8(idx++);
            var MM = this.getUint8(idx++);
            var YY = this.getUint16(idx,true);
            return new Date('' + hh + ':' + mm + ':' + ss + ' ' +
                            dd + ' ' + monthNames[MM-1] + ' ' + YY
                            );
        }

        // Hardcoded to Little endian
        // Called from a 'apply' call where 'this' is the dataview
        var getInt24 = function(offset) {
            var val = this.getUint8(offset+2) << 16;
            val |= this.getUint8(offset+1) << 8;
            val |= this.getUint8(offset);
            var n = val & 0x800000;
            if (!n)
                return val;
            return (0xffffff - val + 1) * -1;
        }

        // Hardcoded to Little endian
        // See above for arguments
        var getUint24 = function(offset) {
            var val = this.getUint8(offset+2) << 16;
            val |= this.getUint8(offset+1) << 8;
            val |= this.getUint8(offset);
            return val;
        }

        var unsupportedType = function(offset) {
            console.error("Unsupported type!");
        }

        // Defined as an object because we skip a lot of indexes
        // Each value is an array:
        //   - Function reference to parse the value
        //   - Factor to apply (divide by). If 0, then don't touch the value (not a number)
        //   - flag to tell if value is signed. Used for bad value detection
        //   - Description
        var log_unit_types = {
             0: [ DataView.prototype.getUint8, 1, false, 'uint8'],
             1: [ DataView.prototype.getInt8, 1, true,  'int8' ],
             2: [ DataView.prototype.getUint16, 1, false, 'uint16'],
             3: [ DataView.prototype.getInt16, 1, true, 'int16'],
             4: [ DataView.prototype.getUint32, 1, false, 'uint32'],
             5: [ DataView.prototype.getInt32, 1, true, 'int32'],
             6: [ DataView.prototype.getUint64, 1, false, 'uint64'],
             7: [ DataView.prototype.getInt64, 1, true, 'int64'],
             8: [ unsupportedType, 1, true, 'float'], // IEEE 754 Float
             9: [ unsupportedType, 1, true, 'double'], // Double
            10: [ unsupportedType, 0, false, 'string'], // ASCII String (not sure about format ?)
            25: [ unsupportedType, 1, false, 'seconds'], // Seconds (not sure about format)
            26: [ unsupportedType, 1, false, 'gps_time'], // GPS Time
            27: [ DataView.prototype.getUint16, 100, false, 'percent * 100'],
            28: [ DataView.prototype.getInt16, 100, true, 'degrees*100'],
            31: [ DataView.prototype.getUint16, 10, true, 'milibar*10'],
            36: [ parseLogDate, 0, false, 'bluetooth_date_time'],
            37: [ getInt24, 100, true, 'meters * 100 (int24)'],
            38: [ getUint24, 100, false, 'g/Kg * 100 (uint24)'],
            39: [ DataView.prototype.getUint16, 1000, false, 'kg/m3 * 1000 (uint16)'],
            40: [ DataView.prototype.getInt16, 10, true, 'Newtons * 10 (int16)'],
            41: [ DataView.prototype.getInt16, 100, true, 'Arc Degrees * 100 (int16)'],
            42: [ DataView.prototype.getInt16, 100, true, 'Arc Degrees / sec *100 (int16)'],
            43: [ DataView.prototype.getUint16, 1, false, 'Milliseconds (uint16)'],
            44: [ getUint24, 1000, false, 'm3/s * 1000 (uint24)'],
            45: [ DataView.prototype.getInt16, 10, true, 'Joules * 10 (uint16)'],
            46: [ DataView.prototype.getInt8, 1, true, 'Arc Degrees (int8)'],
            47: [ DataView.prototype.getUint8, 1, false, 'Arc Degrees (uint8)'],
            48: [ DataView.prototype.getUint16, 10, false, 'Watts * 10 (uint16)'],
            53: [ DataView.prototype.getUint16, 100, false, 'kg/m2 /h * 100 (uint16)'],
            56: [ DataView.prototype.getUint16,1000,  false, 'm/s * 1000 (uint16)'],
            57: [ DataView.prototype.getUint16, 10, false, 'Percent * 10 (uint16)'],
            59: [ DataView.prototype.getUint16, 1, false, 'Degrees (direction)'],
            60: [ getInt24, 10, true, 'Meters * 10 (int24)'],
            61: [ DataView.prototype.getUint16, 10, false, 'W/m2 * 10 (uint16)'],
            62: [ getInt24, 100, true, 'Degrees C * 100 (int24)'],
            63: [ getInt24, 1000, true, 'm/s * 1000 (int24)'],
            64: [ DataView.prototype.getInt16, 100, true, 'Diff. Degrees C * 100 (int16)' ],
            65: [ DataView.prototype.getUint16, 10, false, 'Centimeters * 10 (uint16)'],
            66: [ getUint24, 100, false, 'Meters * 100 (uint24)'],
            67: [ unsupportedType, 1, false, 'Yards [no precision specified]'],
            68: [ getInt24, 1000, true, 'Degrees * 1000 (int24)'],
            69: [ DataView.prototype.getInt16, 100, true, 'Unitless * 100 (int16)'],
        };


         var log_template = [];

        /////////////
        // Private methods
        /////////////

        // Returns starting index of 0x7e
        var sync = function(buffer, maxIndex, minIndex) {
            for (var i = minIndex; i < maxIndex; i++) {
                if (buffer[i] == 0x7e)
                    return i;
            }
            return -1;
        };

        // Unescapes character 0x7d:
        // My understanding so far:
        // - If we find a 0x7d, then look at next byte, if can be 0x5d or 0x5e
        //   which translates into 0x7d and 0x7e respectively. Kinda weird ?
        var linkUnescape = function(buffer) {
            var readIdx = 0;
            var writeIdx = 0;
            var tmpBuffer = new Uint8Array(buffer.length);
            while (readIdx < buffer.length) {
                tmpBuffer[writeIdx] = buffer[readIdx];
                if (buffer[readIdx] == 0x7d) {
                    // console.log('Escaping byte', buffer[readIdx+1]);
                    tmpBuffer[writeIdx] = buffer[readIdx+1] ^ 0x20;
                    readIdx++;
                }
                writeIdx++;
                readIdx++;
            }
            // Now generate a recut buffer of the right size:
            var retBuffer = new Uint8Array(tmpBuffer.buffer, 0, writeIdx);
            return retBuffer;
        }

        // Escapes character 0x7e and 0x7d:
        var linkEscape = function(buffer) {
            var readIdx = 0;
            var writeIdx = 0;
            var tmpBuffer = new Uint8Array(buffer.length*2); // Worst case, everything has to be escaped!
            while (readIdx < buffer.length) {
                tmpBuffer[writeIdx] = buffer[readIdx];
                if (tmpBuffer[writeIdx] == 0x7d) {
                    tmpBuffer[++writeIdx] = 0x5d;
                } else if (tmpBuffer[writeIdx] == 0x7e) {
                    tmpBuffer[writeIdx++] = 0x7d;
                    tmpBuffer[writeIdx] = 0x5e;
                }
                readIdx++;
                writeIdx++
            }
            // Now generate a recut buffer of the right size:
            var retBuffer = new Uint8Array(tmpBuffer.buffer, 0, writeIdx);
            return retBuffer;
        }

        /**
         *   Returns a ready-to-send packet over the link
         * @param {*Number} pkt_type
         * @param {*Uint8Array} payload
         */
        var framePacket = function(pkt_type, payload) {
            var escaped = linkEscape(payload);
            var packet = new Uint8Array(escaped.byteLength + 8);
            var dv = new DataView(packet.buffer);
            packet[0] = 0x7e;
            packet[packet.length-1] = 0x7e;
            dv.setUint16(1, pkt_type, true);
            dv.setUint16(3, escaped.byteLength, true);
            packet.set(escaped, 5);
            var crc = crcCalc.x25_crc(packet.subarray(1,packet.length-3));
            dv.setUint16(packet.length-3, crc, true);
            // Last, pad to 20 bytes packets as required by Kestrel docs
            if (packet.byteLength > 20)
                debug('ERROR: command length does not fit in 20 bytes!');
            var p2 = new Uint8Array(20);
            p2.set(packet);
            // console.info('Framed packet', abutils.hexdump(packet));
            return p2;
        }

        /**
         *  Process a Log protocol data packet once received.
         *  Note that we receive the complete frame including framing
         *  bytes.
         * TODO: Right now, only processes a packet in the context of a data download
         */
        var processPacket = function() {
            var packet = packetList.shift();
            if (!packet)
                return;
            var dv = new DataView(packet.buffer); // packet
            var pkt_type = dv.getUint16(1,true);
            var len = dv.getUint16(3,true);
            // Check that packet is complete
            if (packet.byteLength != (len + 8)) {
                console.error('Kestrel log protocol error, wrong packet length. Expected', len+8, 'got', packet.byteLength);
                return;
            }
            if (pkt_type == PKT_COMMAND) {
                var cmd_code = dv.getUint16(5, true);
                // we are receiving a command from the device
                if (cmd_code == CMD_END_OF_DATA ) { // end_of_data
                    // This is the last packet of the log, we need to close the
                    // protocol
                    driver.output({command:'ack', arg: cmd_code});
                    console.log("Log transfer closed");
                    // TODO: trigger OURSELVES !
                    driver.trigger('data', { 'log_xfer_done': true})
                }
            } else  if (pkt_type == PKT_ACK) {  // ACK
                var cmd_code = dv.getUint16(5, true); // Command that is being ack'ed
                acked_cmd = cmd_code; // We need to update this to understand the next packets we receive
                console.info('ACK for', cmd_code.toString(16));
                // We have an ACK, we should shift our command queue now and clear the busy
                // flag
                driver.shiftQueue();
            } else if (pkt_type == PKT_NACK) { // NACK
                console.error('NACK for', dv.getUint16(5,true));
                console.error('NACK reason is', dv.getUint16(7,true));
            } else if (pkt_type == PKT_DATA) { // Data
                switch (acked_cmd) {
                    case CMD_TOTAL_RECORDS_WRITTEN:
                        var log_totalRecords = dv.getUint32(5, true); // We assume this is a Uint32 until proven otherwise
                        driver.output ({command: 'get_log_size'}); // We replace to make sure this will be processed next
                        break;
                    case CMD_GET_LOG_COUNT_AT:
                        var log_logRecords = dv.getUint32(5, true);
                        setTimeout(function() {driver.trigger('data', { 'log_size': log_logRecords})},0);
                        driver.output({command: 'get_log_data'});
                        break;
                    case CMD_GET_LOG_DATA_AT:
                        parseLogPacket(packet);
                        driver.output({command:'ack', arg: 0xffff});
                        break;
                    case CMD_GET_DATA_SNAPSHOT:
                        var parsed = parseLogFromTemplate(new DataView(packet.buffer),
                                                            5);
                        driver.trigger('data', parsed.data);
                        break;
                    default:
                        console.error('Unknown data response', acked_cmd);
                }
            } else if (pkt_type == PKT_METADATA) {
                // Process log structure.
                parseMetadata(packet, true);
                // Acknowledge we got the data
                driver.output({command:'ack', arg: 0xffff});
            } else if (pkt_type == PKT_METADATA_CONT) {
                parseMetadata(packet, false);
                // Acknowledge we got the data
                driver.output({command:'ack', arg: 0xffff});
            }

            if (packetList.length) {
                setTimeout(processPacket, 0);
            }
        }


        /**
         *  Parse a metadata packet, and populate the generic log packet format.
         * @param {*Buffer} packet
         */
        var parseMetadata = function(packet, isStart) {
            var dv = new DataView(packet.buffer);
            if (isStart) {
                // Clear existing log structure template
                log_template = [];
            } else
                console.log('Metadata packet number:', dv.getUint16(5, true));
            var idx = (isStart) ? 5 : 7;
            while (idx < (packet.byteLength-3)) {
                var fn = dv.getUint16(idx, true);
                var fu = dv.getUint16(idx+2, true);
                var fs = dv.getUint16(idx+4, true);
                console.log('Field name:', fn, log_field_names[fn],
                            'Field Unit:', fu, log_unit_types[fu],
                            'Field Size:', fs);
                log_template.push( [log_field_names[fn],
                                   log_unit_types[fu],
                                   fs]);
                idx += 6;
            }
        }

        /**
         *  Parse a data packed based on the current
         *  log_template.
         * @param {*DataView} dv
         * @param {*int} idx
         */
        var parseLogFromTemplate = function(dv, idx) {
            var data = {};
            for (var i in log_template) {
                var rawval = log_template[i][1][0].apply(dv, [idx, dv]);
                // Detect whether we have a bad value, and skip if bad
                var signed = log_template[i][1][2];
                var l = log_template[i][2];
                // Learned from experience:
                var isBad = (
                    (!signed && l == 2 && rawval == 0xffff) ||
                    (!signed && l == 3 && rawval == 0xffffff) ||
                    // (!signed && l == 4 && rawval == 0xffffffff) ||
                    (signed && l == 2 && rawval == -32767) ||
                    (signed && l == 3 && rawval == -8388607)
                );
                if (!isBad)
                    data[log_template[i][0]] = log_template[i][1][1] ? rawval/log_template[i][1][1] : rawval;
                idx += l;
            }
            console.log(data);
            return { data:data, idx: idx};
        }
        // Parse a log packet. One packet can contain up to 6 log records.
        // So far, only complete log entries have been seen in those packets, waiting for
        // something to break in case we have more than three escaped 0x7e in the packet. No idea
        // whether the Kestrel will send fewer log entries or split a log entry over two packets.
        var parseLogPacket = function(packet) {
            var dv = new DataView(packet.buffer);
            var seq= dv.getUint16(5, true); // Packet sequence number
            // TODO: check that we didn't miss a sequence - could this actually happen??
            console.info('Log sequence #', seq);
            var idx = 7;
            while (idx < (packet.byteLength-43)) { // 1 record is 41 bytes long
                var parsed = parseLogFromTemplate(dv, idx);
                var jsresp = { log: {
                        timestamp: parsed.data.timestamp ? parsed.data.timestamp : 'Unknown',
                        data: parsed.data
                        }
                };
                idx = parsed.idx;
                driver.trigger('data', jsresp);
            }
        }

        /////
        // Public methods
        /////

        // Process a response to a LiNK protocol packet
        this.processProtocol = function(data) {
            ///////
            // Start of a simple state machine to process incoming log data
            ///////
            if (data) { // we sometimes get called without data, to further process the
                        // existing buffer
                // console.log('LLP: Received new data, appending at index', ibIdx);
                inputBuffer.set(new Uint8Array(data.value), ibIdx);
                ibIdx += data.value.byteLength;
                // console.log('I', abutils.hexdump(new Uint8Array(data.value)));
            }
            var start = -1,
                stop = -1;
            if (currentProtoState == P_IDLE) {
                start = sync(inputBuffer, ibIdx, 0);
                //console.info("Found Start at", start);
                if (start > -1) {
                    currentProtoState = P_SYNC;
                    // Edge case: it is possible to have two 0x7e one after another:
                    // this is when we start receiving data, and we get the tail end of
                    // the previous packet, in which case we will get the first 0x7e as the
                    // last byte of the incomplete packet, then 0x7e as the first byte of the
                    // next packet. So if we find out that we have two consecutive 0x72, we
                    // realign on the second one.
                    if (inputBuffer[start+1] == 0x7e)
                        start++;
                    // Realign our buffer (we can copy over overlapping regions):
                    inputBuffer.set(inputBuffer.subarray(start));
                    ibIdx -= start;
                    // console.log('Input buffer is now', inputBuffer);
                } else {
                    return;
                }
            }
            if (currentProtoState == P_SYNC) {
                stop = sync(inputBuffer, ibIdx, 1);
                // console.info("Found End of packet: " + stop);
                currentProtoState = P_IDLE;
            }
            if (stop == -1)
                return; // We are receiving a packet but have not reached the end of it yet
            ///////
            // End of state machine
            ///////
            console.info(abutils.hexdump(inputBuffer.subarray(0, stop+1))); // Display before escaping

            // We now have a complete packet: copy into a new buffer, and realign
            // our input buffer
            var escapedPacket = inputBuffer.subarray(0, stop+1);
            var packet = linkUnescape(escapedPacket);

            // The CRC bytes can also be escaped, careful not to compute before
            // we unescape!
            // Now check our CRC (avoid creating a dataview just for this)
            var receivedCRC = packet[packet.length-3] + (packet[packet.length-2] << 8);

            // CRC is computed on the unescaped packet and includes everything but
            // the framing bytes and CRC itself (of course)
            var computedCRC = crcCalc.x25_crc(packet.subarray(1, packet.length-3));
            // TODO: if computedCRC != receivedCRC, then send a NACK packet
            if (receivedCRC != computedCRC) {
                console.error('CRC Mismatch! received/computed', receivedCRC, computedCRC);
                // TODO: should send a NACK at this stage?
                // console.info(abutils.hexdump(packet.subarray(0, packet.length)));
            } else {
                // console.info("New packet ready");
                packetList.push(packet);
                //setTimeout(processPacket, 0); // Make processing asynchronous
                processPacket();
            }

            // Realign our input buffer to remove what we just send to processing:
            inputBuffer.set(inputBuffer.subarray(stop+1));
            ibIdx -= stop+1;

            if (ibIdx > stop) {
                self.processProtocol(); // We still have data to process, so we call ourselves recursively
                return;
            }
            return;
        }



        /**
         *   Make a command packet (returns the framed command)
         * @param {*Number} cmd_code
         * @param {*String or Uint8Array} cmd_arg Hex string or Uint8Array
         */
        this.makeCommand = function(cmd_code, cmd_arg) {
            if (cmd_arg) {
                if ( typeof cmd_arg == 'string') {
                    cmd_arg = abutils.hextoab(cmd_arg);
                }
             } else {
                cmd_arg = new Uint8Array(0);
            }
            var packet = new Uint8Array(cmd_arg.byteLength + 2);
            console.log(packet, packet. buffer);
            var dv = new DataView(packet.buffer);
            dv.setUint16(0, cmd_code, true);
            packet.set(cmd_arg, 2);
            console.info('Raw command', abutils.hexdump(packet));
            return framePacket(PKT_COMMAND, packet);
        }

        /**
         * Make an ACK packet (returns the framed ACK packet ready to send)
         */
        this.makeAck = function(cmd_code) {
            var packet = new Uint8Array(2);
            var dv = new DataView(packet.buffer);
            dv.setUint16(0, cmd_code, true);
            return framePacket(PKT_ACK, packet);
        }




    }

    // On server side, we use the Node eventing system, whereas on the
    // browser/app side, we use Bacbone's API:
    if (vizapp.type != 'server') {
        // Add event management to our parser, from the Backbone.Events class:
        _.extend(linkProtocol.prototype, Backbone.Events);
    } else {
        linkProtocol.prototype.__proto__ = events.EventEmitter.prototype;
        linkProtocol.prototype.trigger = linkProtocol.prototype.emit;
    }
    return linkProtocol;
});