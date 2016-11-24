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
 * The controller communication manager:
 *  - provides API to the backend device to use by views
 *
 * @author Edouard Lafargue, ed@lafargue.name
 */

define(function (require) {
    "use strict";


    // linkManager is a reference to the parent link manager
    return function () {

        var self = this;
        var lm = linkManager;
        var streaming = false;
        var streamingText = false;
        var livePoller = null; // Reference to the timer for live streaming
        var textPoller = null; // This is a poller to read from the radio TB buffer.

        var kxpa100 = false; // Keep track of the presence of an amplifier


        //////
        //  Standard API:
        // All link managers need this function:
        //////
        this.getBackendDriverName = function () {
            return 'kenwood_v71';
        }

        //////
        // End of standard API
        //////

        //////
        // Common Radio instrument API
        /////

        /**
         * We accept either a preformatted string of 11 characters, or a number in MHz, both are OK
         */
        this.setVFO = function (f, vfo) {
        };

        this.getVFO = function(vfo) {
        }

        this.getMode = function () {
        }

        this.setMode = function (code) {
        }

        /**
         * Returns a list of all modes supported by the radio
         */
        this.getModes = function() {
        }

        /**
         * if key = true, they transmit
         */
        this.ptt = function(key) {
        }

        /**
         * Get the SMeter reading
         */
        this.getSmeter = function() {
        }


        /*********
         *   End of common radio API
         */
        // All commands below are fully free and depend on
        // the instrument's capabilities

        this.memoryChannel = function(mem) {
            lm.sendCommand({ command: 'set_mem_channel', arg: mem});
        }

        console.log('Started Kenwood link manager driver..');

    };

});