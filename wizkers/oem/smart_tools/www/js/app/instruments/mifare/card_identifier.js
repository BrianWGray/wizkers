/**
 * This file is part of Wizkers.io
 *
 * The MIT License (MIT)
 *  Copyright (c) 2018 Edouard Lafargue, ed@wizkers.io
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
 * These utilities do ATR parsing for many types of ATR, including
 * PCSC 2.0 Contactless ATR parsing
 *
 * (c) Edouard Lafargue 2008, edouard@lafargue.name
 * Based on original work by Ludovic Rousseau
 *
 */

if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define(function(require) {

    "use strict";

    var abutils = require('app/lib/abutils');
    var SCList = require('./smartcard_list.js');

    var counter = 1;
    var T = 0;
    var atr = "";
    var ts = new Array();
    ts[0x3B] = "Direct Convention";
    ts[0x3F] = "Inverse Convention";
    var Fi = [372, 372, 558, 744, 1116, 1488, 1860, "RFU", "RFU", 512, 768, 1024, 1536, 2048, "RFU", "RFU"];
    var Di = ["RFU", 1, 2, 4, 8, 16, 32, "RFU", 12, 20, "RFU", "RFU", "RFU", "RFU", "RFU", "RFU"];
    var XI = ["not supported", "state L", "state H", "no preference"];
    var UI = ["A only (5V)", "B only (3V)", "A and B", "RFU"];

    // Kept as a memory. I was young
    /*
    function Hex(dec) {
        var hexa = "0123456789ABCDEF";
        var hex = "";
        while (dec > 15) {
            t = dec - (Math.floor(dec / 16)) * 16;
            hex = hexa.charAt(t) + hex;
            dec = Math.floor(dec / 16);
        }
        hex = hexa.charAt(dec) + hex;
        if (hex == 0) {
            return "00"
        }
        return hex;
    } */

    function Hex(dec) {
        return ("00" + dec.toString(16)).slice(-2).toUpperCase();
    }


    /*
    * Reads card info from the hidden "carddb" inner frame
    */
    function getCard(atr) {
        var a1 = abutils.ui8tohex(new Uint8Array(atr)).replace(/(.{2})/g,"$1 ").toUpperCase();
        a1 = a1.slice(0,-1); // Remove last space
        var hits = [];
        for (var card in SCList) {
            for (atr in SCList[card].atrs) {
                if (a1.match(SCList[card].atrs[atr])) {
                    SCList[card].candidates.forEach(function(c) {
                        hits.push(c);
                    });
                }
            }
        }
        return hits;
    }

    /*
    * Parses an ATR
    */
    function parseATR(atr_ab) {
        var atr = [].slice.call(new Uint8Array(atr_ab)); // Make an array of bytes
        var result = "ATR: <tt>" + abutils.ui8tohex(new Uint8Array(atr_ab)) + "</tt><br>";
        
        counter = 1;
        // Get TS value:
        var ats = atr.shift();
        result += "TS: " + Hex(ats) + " (" + ts[ats] + ")<br>";
        
        // analyse T0:
        var t0 = atr.shift();
        result += "T0: " + Hex(t0);
        var Y1 = t0 >> 4;
        result += " Y(1): " + Y1;
        var K = t0 % 16;
        result += " K: " + K + " (historical bytes)<br>";
        
        if (Y1 & 0x01) {
            // analyse TA
            result += analyze_ta(atr);
        }
        
        if (Y1 & 0x02) {
            // analyse TB
            result += analyze_tb(atr);
        }
        if (Y1 & 0x04) {
            // analyse TC
            result += analyze_tc(atr);
        }
        if (Y1 & 0x08) {
            // analyse TD
            result += analyze_td(atr);
        }
        
        // TCK is present?
        var TCK = '';
        if (atr.length == (K + 1)) {
            // expected TCK
            var tck_e = atr.pop();
            //calculated TCK
            var tck_c = 0;
            var atr2 = new Uint8Array(atr_ab);;
            for (var i = 1; i < atr2.length; i++) {
                tck_c ^= atr2[i];
            }
            TCK += "<br>---<br>Checksum: " + Hex(tck_e);
            if (tck_c == 0) {
                TCK += " (correct checksum)";
            } else {
                TCK += " WRONG CHECKSUM, expected " + Hex(tck_e^tck_c);
            }
        }
        
        result += " + Historical bytes: <tt>" + abutils.ui8tohex(new Uint8Array(atr)) + "</tt><br>";
        if (atr.length + 1 < K) {
            result += " ERROR! ATR is truncated: " + (K - atr.length - 1) + " byte(s) is/are missing<br>";
        }
        result += analyze_historical_bytes(atr);
        result += TCK;

        var hits = getCard(atr_ab);
        
        return { atr_desc: result, candidates: hits };

        //
        // LEGACY CODE: used to load the ExtJS card-specific parser
        //
        
        // Check if the card ATR is known
        var card = getCard(atr_ab);
        var cardInfoEl = Ext.get('cardInfo');
        if (card) {
            cardInfoEl.update(card.name);
            if (card.xplorer) {
                // Load the Explorer
                var xplo = Ext.get("xPlorer").getUpdater();
                xplo.loadScripts = true;
                xplo.update({
                    url : card.xplorer,
                    scripts : true,
                    method : 'get',
                    atr : options.atr,
                    reader : options.reader,
                    callback : function (el, success, response, options) {
                        // Need the settimeout for IE compatibility
                        var startE = function () {
                            start_explorer(options.reader, options.atr);
                        }
                        setTimeout(startE, 100);
                    }
                });
            }
        } else {
            cardInfoEl.update("Unknown card");
        }
    }

    function analyze_ta(atr) {
        var result = "";
        var value = atr.shift();
        result += "TA(" + counter + ")=" + Hex(value) + " --> ";
        // decode TA1
        if (counter == 1) {
            var F = value >> 4;
            var D = value % 16;
            (Di[D] != "RFU") ? value = Fi[F] / Di[D] : '';
            result += " Fi=" + Fi[F] + ", Di=" + Di[D] + ", " + value + " cycles/ETU";
            result += " (" + 3571200 / value + "bits/s at 3.57 MHz)<br>";
        }
        if (counter == 2) {
            var F = value >> 4;
            var D = value % 16;
            result += " Protocol to be used in spec mode: T=" + D;
            if (F & 0x8) {
                result += " - Unable to change<br>";
            } else {
                print += " - Capable to change<br>";
            }
            if (F & 0x1) {
                result += " - implicity defined<br>";
            } else {
                result += " - defined by interface bytes<br>";
            }
        }
        if (counter >= 3) {
            if (T == 1) {
                result += "IFSC: " + value + "<br>\n";
            } else {
                /* T <> 1 */
                var F = value >> 6;
                var D = value % 64;
                var Cl = "(3G) ";
                
                if (D & 0x1)
                    Cl += "A 5V ";
                if (D & 0x2)
                    Cl += "B 3V ";
                if (D & 0x4)
                    Cl += "C 1.8V ";
                if (D & 0x8)
                    Cl += "D RFU ";
                if (D & 0x10)
                    Cl += "E RFU";
                
                result += "Clock stop: " + XI[F] + " - Class accepted by the card: " + Cl + "<br>";
            }
            
        }
        return result;
    }

    function analyze_tb(atr) {
        
        var result = "";
        var value = atr.shift();
        result += "<br>  TB(" + counter + ") = " + Hex(value) + " --> ";
        
        var I = value >> 5;
        var PI = value % 32;
        
        if (counter == 1) {
            if (PI == 0) {
                result += "VPP is not electrically connected";
            } else {
                result += "Programming Param P: " + PI + " Volts, I: " + I + " milliamperes";
            }
        }
        
        if (counter == 2) {
            result += "Programming param PI2 (PI1 should be ignored): ";
            if ((value > 49) || (value < 251)) {
                result += value + " (dV)";
            } else {
                result += value + " is RFU";
            }
        }
        
        if (counter >= 3) {
            if (T == 1) {
                var BWI = value >> 4;
                var CWI = value % 16;
                
                result += "Block Waiting Integer: " + BWI + " - Character Waiting Integer: " + CWI;
            }
        }
        return result;
    }

    function analyze_tc(atr) {
        
        var value = atr.shift();
        var result = "<br>  TC(" + counter + ") = " + Hex(value) + " --> ";
        
        if (counter == 1) {
            result += "Extra guard time: " + value;
            if (value == 255)
                result += " (special value)";
        }
        
        if (counter == 2) {
            result += "Work waiting time: 960 x " + value + " x (Fi/F)";
        }
        
        if (counter >= 3) {
            if (T == 1) {
                result += "Error detection code: ";
                if (value == 1) {
                    result += "CRC";
                } else if (value == 0) {
                    result += "LRC";
                } else {
                    result += "RFU";
                }
            }
        }
        
        return result + "<br>";
    }

    function analyze_td(atr) {
        
        var value = atr.shift();
        var result = "";
        
        var Y = value >> 4;
        var T = value % 16;
        
        result += "  TD(" + counter + ") = " + Hex(value) + " --> Y(i+1) = " + Y + " Protocol T=" + T;
        if (T == 15) {
            result += " - Global interface bytes following";
        }
        
        counter++;
        result += "<br>-----<br>";
        
        if (atr.length == 0)
            return result;
        if (Y & 0x1)
            result += analyze_ta(atr);
        
        if (atr.length == 0)
            return result;
        if (Y & 0x2)
            result += analyze_tb(atr);
        
        if (atr.length == 0)
            return result;
        if (Y & 0x4)
            result += analyze_tc(atr);
        
        if (atr.length == 0)
            return result;
        if (Y & 0x8)
            result += analyze_td(atr);
        
        return result;
    }

    function analyze_historical_bytes(atr) {
        var hb_category = atr.shift();
        
        // return if we have NO historical bytes
        if (hb_category == null)
            return;
        
        var result = "  Category indicator byte: " + Hex(hb_category);
        
        switch (hb_category) {
        case 0x00:
            result += " (compact TLV data object)<br>";
            if (atr.length < 3) {
                result += "    Error in the ATR: expecting 3 bytes and got " + atr.length + "<br>";
                break;
            }
            
            var status = new Array();
            // get the 3 last bytes
            for (var i = 0; i < 3; i++) {
                status[2 - i] = atr.pop();
            }
            while (atr.length) {
                result += compact_tlv(atr);
            }
            var lcs = status.shift();
            var sw1 = status.shift();
            var sw2 = status.shift();
            result += "    Mandatory status indicator (3 last bytes)<br>\n";
            result += "      LCS (life card cycle): " + Hex(lcs) + "<br>";
            result += "      SW: " + Hex(sw1) + " " + Hex(sw2) + "<br>";
            break;
            
        case 0x80:
            result += " (compact TLV data object) <br>";
            result += "<ul>";
            while (atr.length)
                result += compact_tlv(atr);
            result += "</ul>";
            break;
            
        case 0x10:
            result += " (next byte is the DIR data reference)<br>";
            var data_ref = atr.shift();
            result += "   DIR data reference: " + Hex(data_ref) + "<br>\n";
            break;
            
        case 0x81:
        case 0x82:
        case 0x83:
        case 0x84:
        case 0x85:
        case 0x86:
        case 0x87:
        case 0x88:
        case 0x89:
        case 0x8A:
        case 0x8B:
        case 0x8C:
        case 0x8D:
        case 0x8E:
        case 0x8F:
            result += " (Reserved for futur use)\n";
            break;
        default:
            result += " (proprietary format)\n";
        }
        return result;
    }

    function compact_tlv(atr) {
        var tlv = atr.shift();
        
        // the TLV _may_ be present
        if (tlv == '')
            return '(tlv absent)<br/>';
        
        var tag = tlv >> 4;
        var len = tlv % 16;
        
        var result = "<li>Tag: " + tag + ", len: " + len;
        
        switch (tag) {
            
        case 0x1:
            result += " (country code, ISO 3166-1)<br>";
            var data = abutils.u8itohex(new Uint8Array(atr));
            result += "      Country code: " + data.substring(0, len * 2) + "<br>";
            atr.splice(0, len);
            break;
            
        case 0x2:
            result += " (issuer identification number, ISO 7812-1)<br>";
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Issuer identification number: " + data.substring(0, len * 2) + "<br>";
            atr.splice(0, len);
            break;
            
        case 0x3:
            var cs = atr.shift();
            result += " (card service data byte)<br>";
            if (cs == '' || cs == undefined) {
                result += "      Error in the ATR: expecting 1 byte and got 0<br>";
                break;
            }
            result += "      Card service data byte: " + Hex(cs) + "<br>"
            result += cs_parse(cs);
            break;
            
        case 0x4:
            
            result += " (initial access data)<br>";
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Initial access data: <tt>" + data.substring(0, len * 2) + "</tt><br>";
            /* if len = F, then the contents are application Identifier data */
            if (len == 0xF)
                result += aid_parse(atr);
            break;
        case 0x5:
            result += " (card issuer data)<br>";
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Card issuer data: <tt>" + data.substring(0, len * 2) + "</tt><br>";
            result += "       -> this information is specific to the card issuer and cannot be parsed as such.<br>";
            atr.splice(0, len);
            break;
            
        case 0x6:
            result += " (pre-issuing data)<br>";
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Data: <tt>" + data.substring(0, len * 2) + "</tt><br>";
            atr.splice(0, len);
            break;
            
        case 0x7:
            result += " (card capabilities)<br>";
            switch (len) {
            case 0x1:
                /*
                /1/ && do{
                my $sm = shift @object;
                print "      Selection methods: $sm\n";
                sm($sm);
                last;
                };
                */
                break;
            case 0x2:
                
                /*
                /2/ && do{
                my $sm = shift @object;
                my $dc = shift @object;
                print "      Selection methods: $sm\n";
                sm($sm);
                print "      Data coding byte: $dc\n";
                dc($dc);
                last;
                };
                */
                break;
            case 0x3:
                /*
                /3/ && do{
                my $sm = shift @object;
                my $dc = shift @object;
                my $cc = shift @object;
                print "      Selection methods: $sm\n";
                sm($sm);
                print "      Data coding byte: $dc\n";
                dc($dc);
                print "      Command chaining, length fields and logical channels: $cc\n";
                cc($cc);
                last;
                };
                */
                break;
            default:
                /*
                print "      wrong ATR\n";
                */
                
            }
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Value: <tt>" + data.substring(0, len * 2) + "</tt><br>";
            atr.splice(0, len);
            break;
            
        case 0x8:
            result += " (status indicator)<br>";
            switch (len) {
            case 0x1:
                var lcs = atr.shift();
                result += "      LCS (life card cycle): " + Hex(lcs) + "<br>";
                break;
            case 0x2:
                var sw1 = atr.shift();
                var sw2 = atr.shift();
                result += "      SW: " + Hex(sw1) + " " + Hex(sw2) + "<br>";
                break;
                
            case 0x3:
                var lcs = atr.shift();
                var sw1 = atr.shift();
                var sw2 = atr.shift();
                result += "      LCS (life card cycle): " + Hex(lcs) + " ()<br>";
                result += "      SW: " + Hex(sw1) + " " + Hex(sw2) + "<br>";
                break;
            }
            break;
            /*
            case 0xF:
            print " (application identifier)\n";
            print "      Application identifier: " . (join ' ', splice @object, 0, hex $len) . "\n";
            last;
            };
            */
        default:
            result += " (unknown)<br>\n";
            var data = abutils.ui8tohex(new Uint8Array(atr));
            result += "      Value: <tt>" + data.substring(0, len * 2) + "</tt><br>";
            atr.splice(0, len);
        }
        
        return result;
    }

    /*
    # see table 86 -- First software function table (selection methods),
    # page 60 of ISO 7816-4
    */
    function sm(value) {
        /*
        # convert in a list of 0 or 1
        my @sm = split //, unpack ("B32", pack ("N", hex shift));
        
        # remove the 24 first bits
        splice @sm, 0, 24;
        
        print "        - DF selection by full DF name\n" if shift @sm;
        print "        - DF selection by partial DF name\n" if shift @sm;
        print "        - DF selection by path\n" if shift @sm;
        print "        - DF selection by file identifier\n" if shift @sm;
        print "        - Implicit DF selection\n" if shift @sm;
        print "        - Short EF identifier supported\n" if shift @sm;
        print "        - Record number supported\n" if shift @sm;
        print "        - Record identifier supported\n" if shift @sm;
        */
    }

    function aid_parse(atr) {
        /* From PCSC3 v2_01_04_sup */
        var len = atr.shift();
        var rid = new Array();
        var SS = ["No information given", "ISO 14443 A, part 1", "ISO 14443 A, part 2", "ISO 14443 A, part 3", "RFU",
            "ISO 14443 B, part 1", "ISO 14443 B, part 2", "ISO 14443 B, part 3", "RFU",
            "ISO 15693, part 1", "ISO 15693, part 2", "ISO 15693, part 3", "ISO 15693, part 4",
            "Contact (7816-10) I2C", "Contact (7816-10) Extended I2C", "Contact (7816-10) 2WBP", "Contact (7816-10) 3WBP"];
        var NN = ["Invalid", "Mifare Standard 1K", "Mifare Standard 4K", "Mifare Ultralight", "SLE5RR_XXXX",
            "Invalid?", "SRI 176", "SRIX4K", "AT88RF020", "AT88SC0204CRF", "AT88SC0808CRF", "AT88SC1616CRF", "AT88SC3216CRF", "AT88SC6416CRF", "SRF55V10P", "SRF55V02P", "SRF55V10S", "SRF55V02S", "TAG_IT", "LRI512", "ICODESLI", "TEMPSENS", "I.CODE1", "PicoPass 2K", "PicoPass 2KS", "PicoPass 16K", "PicoPass 16Ks", "PicoPass 16K(8x2)", "PicoPass 16KS(8x2)", "PicoPass 32KS(16+16)", "PicoPass 32KS(16+8x2)", "PicoPass 32KS(8x2+16)", "PicoPass 32KS(8x2+8x2)", "LRI64", "I.CODE UID", "I.CODE EPC", "LRI12", "LRI128", "Mifare Mini"];
        
        for (var i = 0; i < 5; i++) {
            rid[i] = atr.shift();
        }
        var str_rid = abutils.ui8tohex(new Uint8Array(rid));
        switch (str_rid) {
        case "a000000306":
            var result = "RID: A000000306: PC/SC Workgroup<br>";
            var SSindex = atr.shift(); // Card name
            result += "SS: " + Hex(SSindex) + " -> " + SS[SSindex] + " (card standard)<br>";
            var NNindex = atr.shift() + atr.shift();
            result += "NN: " + Hex(NNindex) + " -> " + NN[NNindex] + " (card name)<br>";
        }
        atr.splice(0, len - 8);
        return result;
    }

    /* see table 85 -- Card service data byte, page 59 of ISO 7816-4 */
    function cs_parse(cs) {
        
        var result = "";
        if (cs & 0x80)
            result += "        - Application selection: by full DF name<br>";
        if (cs & 0x40)
            result += "        - Application selection: by partial DF name<br>";
        if (cs & 0x20)
            result += "        - BER-TLV data objects available in EF.DIR<br>";
        if (cs & 0x10)
            result += "        - BER-TLV data objects available in EF.ATR<br>";
        
        var v = cs & 0xE;
        result += "        - EF.DIR and EF.ATR access services: ";
        switch (v) {
        case 8:
            result += "by READ BINARY command<br>";
            break;
        case 0:
            result += "by GET RECORD(s) command<br>";
            break;
        case 4:
            result += "by GET DATA command<br>";
            break;
        default:
            result += "reserved for future use";
        }
        
        if (cs & 0x1) {
            result += "        - Card without MF<br>";
        } else {
            result += "        - Card with MF<br>";
        }
        return result;
    }

    return {
        parseATR: parseATR
    }


});
