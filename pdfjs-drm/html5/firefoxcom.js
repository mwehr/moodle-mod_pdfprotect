/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define('pdfjs-web/firefoxcom', ['exports', 'pdfjs-web/preferences',
            'pdfjs-web/app', 'pdfjs-web/pdfjs'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports, require('./preferences.js'), require('./app.js'),
            require('./pdfjs.js'));
    } else {
        factory((root.pdfjsWebFirefoxCom = {}), root.pdfjsWebPreferences,
            root.pdfjsWebApp, root.pdfjsWebPDFJS);
    }
}(this, function(exports, preferences, app, pdfjsLib) {
//#if FIREFOX || MOZCENTRAL
    var Preferences = preferences.Preferences;
    var PDFViewerApplication = app.PDFViewerApplication;

    var FirefoxCom = (function FirefoxComClosure() {
        return {
            /**
             * Creates an event that the extension is listening for and will
             * synchronously respond to.
             * NOTE: It is reccomended to use request() instead since one day we may not
             * be able to synchronously reply.
             * @param {String} action The action to trigger.
             * @param {String} data Optional data to send.
             * @return {*} The response.
             */
            requestSync : function(action, data) {
                var request = document.createTextNode('');
                document.documentElement.appendChild(request);

                var sender = document.createEvent('CustomEvent');
                sender.initCustomEvent('DRM.message', true, false,
                    {action : action, data : data, sync : true});
                request.dispatchEvent(sender);
                var response = sender.detail.response;
                document.documentElement.removeChild(request);
                return response;
            },
            /**
             * Creates an event that the extension is listening for and will
             * asynchronously respond by calling the callback.
             * @param {String} action The action to trigger.
             * @param {String} data Optional data to send.
             * @param {Function} callback Optional response callback that will be called
             * with one data argument.
             */
            request     : function(action, data, callback) {
                var request = document.createTextNode('');
                if (callback) {
                    document.addEventListener('DRM.response', function listener(event) {
                        var node = event.target;
                        var response = event.detail.response;

                        document.documentElement.removeChild(node);

                        document.removeEventListener('DRM.response', listener, false);
                        return callback(response);
                    }, false);
                }
                document.documentElement.appendChild(request);

                var sender = document.createEvent('CustomEvent');
                sender.initCustomEvent('DRM.message', true, false, {
                    action           : action,
                    data             : data,
                    sync             : false,
                    responseExpected : !!callback
                });
                return request.dispatchEvent(sender);
            }
        };
    })();

    var DownloadManager = (function DownloadManagerClosure() {
        function DownloadManager() {
        }

        DownloadManager.prototype = {
            downloadUrl : function DownloadManager_downloadUrl(url, filename) {
                FirefoxCom.request('download', {
                    originalUrl : url,
                    filename    : filename
                });
            },

            downloadData : function DownloadManager_downloadData(data, filename,
                                                                 contentType) {
                var blobUrl = pdfjsLib.createObjectURL(data, contentType, false);

                FirefoxCom.request('download', {
                    blobUrl      : blobUrl,
                    originalUrl  : blobUrl,
                    filename     : filename,
                    isAttachment : true
                });
            },

            download : function DownloadManager_download(blob, url, filename) {
                var blobUrl = window.URL.createObjectURL(blob);

                FirefoxCom.request('download', {
                        blobUrl     : blobUrl,
                        originalUrl : url,
                        filename    : filename
                    },
                    function response(err) {
                        if (err && this.onerror) {
                            this.onerror(err);
                        }
                        window.URL.revokeObjectURL(blobUrl);
                    }.bind(this)
                );
            }
        };

        return DownloadManager;
    })();

    Preferences._writeToStorage = function(prefObj) {
        return new Promise(function(resolve) {
            FirefoxCom.request('setPreferences', prefObj, resolve);
        });
    };

    Preferences._readFromStorage = function(prefObj) {
        return new Promise(function(resolve) {
            FirefoxCom.request('getPreferences', prefObj, function(prefStr) {
                var readPrefs = JSON.parse(prefStr);
                resolve(readPrefs);
            });
        });
    };

    (function listenFindEvents() {
        var events = [
            'find',
            'findagain',
            'findhighlightallchange',
            'findcasesensitivitychange'
        ];
        var handleEvent = function(evt) {
            if (!PDFViewerApplication.initialized) {
                return;
            }
            PDFViewerApplication.eventBus.dispatch('find', {
                source        : window,
                type          : evt.type.substring('find'.length),
                query         : evt.detail.query,
                phraseSearch  : true,
                caseSensitive : !!evt.detail.caseSensitive,
                highlightAll  : !!evt.detail.highlightAll,
                findPrevious  : !!evt.detail.findPrevious
            });
        }.bind(this);

        for (var i = 0, len = events.length; i < len; i++) {
            window.addEventListener(events[i], handleEvent);
        }
    })();

    function FirefoxComDataRangeTransport(length, initialData) {
        pdfjsLib.PDFDataRangeTransport.call(this, length, initialData);
    }

    FirefoxComDataRangeTransport.prototype =
        Object.create(pdfjsLib.PDFDataRangeTransport.prototype);
    FirefoxComDataRangeTransport.prototype.requestDataRange =
        function FirefoxComDataRangeTransport_requestDataRange(begin, end) {
            FirefoxCom.request('requestDataRange', {begin : begin, end : end});
        };
    FirefoxComDataRangeTransport.prototype.abort =
        function FirefoxComDataRangeTransport_abort() {
            // Sync call to ensure abort is really started.
            FirefoxCom.requestSync('abortLoading', null);
        };

    PDFViewerApplication.externalServices = {
        updateFindControlState : function(data) {
            FirefoxCom.request('updateFindControlState', data);
        },

        initPassiveLoading : function(callbacks) {
            var pdfDataRangeTransport;

            window.addEventListener('message', function windowMessage(e) {
                if (e.source !== null) {
                    // The message MUST originate from Chrome code.
                    console.warn('Rejected untrusted message from ' + e.origin);
                    return;
                }
                var args = e.data;

                if (typeof args !== 'object' || !('pdfjsLoadAction' in args)) {
                    return;
                }
                switch (args.pdfjsLoadAction) {
                    case 'supportsRangedLoading':
                        pdfDataRangeTransport =
                            new FirefoxComDataRangeTransport(args.length, args.data);

                        callbacks.onOpenWithTransport(args.pdfUrl, args.length,
                            pdfDataRangeTransport);
                        break;
                    case 'range':
                        pdfDataRangeTransport.onDataRange(args.begin, args.chunk);
                        break;
                    case 'rangeProgress':
                        pdfDataRangeTransport.onDataProgress(args.loaded);
                        break;
                    case 'progressiveRead':
                        pdfDataRangeTransport.onDataProgressiveRead(args.chunk);
                        break;
                    case 'progress':
                        callbacks.onProgress(args.loaded, args.total);
                        break;
                    case 'complete':
                        if (!args.data) {
                            callbacks.onError(args.errorCode);
                            break;
                        }
                        callbacks.onOpenWithData(args.data);
                        break;
                }
            });
            FirefoxCom.requestSync('initPassiveLoading', null);
        },

        fallback : function(data, callback) {
            FirefoxCom.request('fallback', data, callback);
        },

        reportTelemetry : function(data) {
            FirefoxCom.request('reportTelemetry', JSON.stringify(data));
        },

        createDownloadManager : function() {
            return new DownloadManager();
        },

        get supportsIntegratedFind() {
            var support = FirefoxCom.requestSync('supportsIntegratedFind');
            return pdfjsLib.shadow(this, 'supportsIntegratedFind', support);
        },

        get supportsDocumentFonts() {
            var support = FirefoxCom.requestSync('supportsDocumentFonts');
            return pdfjsLib.shadow(this, 'supportsDocumentFonts', support);
        },

        get supportsDocumentColors() {
            var support = FirefoxCom.requestSync('supportsDocumentColors');
            return pdfjsLib.shadow(this, 'supportsDocumentColors', support);
        },

        get supportedMouseWheelZoomModifierKeys() {
            var support = FirefoxCom.requestSync('supportedMouseWheelZoomModifierKeys');
            return pdfjsLib.shadow(this, 'supportedMouseWheelZoomModifierKeys',
                support);
        },
    };

//// l10n.js for Firefox extension expects services to be set.
    document.mozL10n.setExternalLocalizerServices({
        getLocale : function() {
            return FirefoxCom.requestSync('getLocale', null);
        },

        getStrings : function(key) {
            return FirefoxCom.requestSync('getStrings', key);
        }
    });

    exports.DownloadManager = DownloadManager;
    exports.FirefoxCom = FirefoxCom;
//#endif
}));
