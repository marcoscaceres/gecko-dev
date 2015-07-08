/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.importGlobalProperties(['Blob']);

Cu.import("resource://gre/modules/PageThumbUtils.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "ManifestObtainer",
 "resource://gre/modules/ManifestObtainer.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ManifestFinder",
 "resource://gre/modules/ManifestFinder.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "ImageObjectUtils",
 "resource://gre/modules/ImageObjectUtils.jsm");

const STATE_LOADING = 1;
const STATE_CAPTURING = 2;
const STATE_CANCELED = 3;

const backgroundPageThumbsContent = {

  init: function () {
    Services.obs.addObserver(this, "document-element-inserted", true);

    // We want a low network priority for this service - lower than b/g tabs
    // etc - so set it to the lowest priority available.
    this._webNav.QueryInterface(Ci.nsIDocumentLoader).
      loadGroup.QueryInterface(Ci.nsISupportsPriority).
      priority = Ci.nsISupportsPriority.PRIORITY_LOWEST;

    docShell.allowMedia = false;
    docShell.allowPlugins = false;
    docShell.allowContentRetargeting = false;
    //Ci.nsIRequest.LOAD_NORMAL
    let defaultFlags = Ci.nsIRequest.LOAD_ANONYMOUS |
                       Ci.nsIRequest.LOAD_BYPASS_CACHE |
                       Ci.nsIRequest.INHIBIT_CACHING |
                       Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_HISTORY;
    docShell.defaultLoadFlags = defaultFlags;

    addMessageListener("BackgroundPageThumbs:capture",
                       this._onCapture.bind(this));
    docShell.
      QueryInterface(Ci.nsIInterfaceRequestor).
      getInterface(Ci.nsIWebProgress).
      addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);
  },

  observe: function (subj, topic, data) {
    // Arrange to prevent (most) popup dialogs for this window - popups done
    // in the parent (eg, auth) aren't prevented, but alert() etc are.
    // disableDialogs only works on the current inner window, so it has
    // to be called every page load, but before scripts run.
    if (content && subj == content.document) {
      content.
        QueryInterface(Ci.nsIInterfaceRequestor).
        getInterface(Ci.nsIDOMWindowUtils).
        disableDialogs();
    }
  },

  get _webNav() {
    return docShell.QueryInterface(Ci.nsIWebNavigation);
  },

  _onCapture: function (msg) {
    dump(`
      =====
      backgroundPageThumbsContent: _onCapture....
      =======
    `);
    this._nextCapture = {
      id: msg.data.id,
      url: msg.data.url,
      isPreview: (msg.data.isPreview || false),
    };
    if (this._currentCapture) {
      if (this._state == STATE_LOADING || this._nextCapture.isPreview) {
        // Cancel the current capture.
        this._state = STATE_CANCELED;
        this._loadAboutBlank();
      }
      // Let the current capture finish capturing, or if it was just canceled,
      // wait for onStateChange due to the about:blank load.
      dump(`
        =====
        backgroundPageThumbContent: _onCapture....waiting for about blank...
        =======
      `);
      return;
    }
    this._startNextCapture();
  },

  _startNextCapture: function () {
    if (!this._nextCapture)
      return;
    this._currentCapture = this._nextCapture;
    delete this._nextCapture;
    this._state = STATE_LOADING;
    this._currentCapture.pageLoadStartDate = new Date();

    try {
      this._webNav.loadURI(this._currentCapture.url,
                           Ci.nsIWebNavigation.LOAD_FLAGS_STOP_CONTENT,
                           null, null, null);
    } catch (e) {
      this._failCurrentCapture("BAD_URI");
      delete this._currentCapture;
      this._startNextCapture();
    }
  },

  onStateChange: function (webProgress, req, flags, status) {
    if (webProgress.isTopLevel &&
        (flags & Ci.nsIWebProgressListener.STATE_STOP) &&
        this._currentCapture) {
      if (req.name == "about:blank") {
        if (this._state == STATE_CAPTURING) {
          // about:blank has loaded, ending the current capture.
          this._finishCurrentCapture();
          delete this._currentCapture;
          this._startNextCapture();
        }
        else if (this._state == STATE_CANCELED) {
          // A capture request was received while the current capture's page
          // was still loading.
          delete this._currentCapture;
          this._startNextCapture();
        }
      }
      else if (this._state == STATE_LOADING) {
        // The requested page has loaded.  Capture it.
        this._state = STATE_CAPTURING;
        this._captureCurrentPage();
      }
    }
  },
  _captureCurrentPage: Task.async(function* () {
    let capture = this._currentCapture;
    let canvas = PageThumbUtils.createCanvas(content);
    capture.finalURL = this._webNav.currentURI.spec;
    capture.pageLoadTime = new Date() - capture.pageLoadStartDate;
    dump(`
      ========
      backgroundPageThumbsContent::_captureCurrentPage:
        capture.finalURL : ${capture.finalURL}
        capture.isPreview : ${capture.isPreview}
    `);
    let canvasDrawDate = new Date();
    let finder = new ManifestFinder();
    let hasManifest = yield finder.hasManifestLink(content);
    //It's NOT a preview or has a manifest
    if (hasManifest) {
      let obtainer = new ManifestObtainer();
      try {
        let manifest = yield obtainer.obtainManifest(content);
        //try to create icon
        if (manifest.icons.length) {
          dump(`
            ##########
    backgroundPageThumbsContent::_captureCurrentPage
    WE HAVE ICONS: ${manifest.icons.length}
            ##########
          `);
          yield this._createThumbFromManifestIcon(canvas, manifest);
        }
      } catch (err) {
        dump(`
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
          ########## THERE WAS AN ERROR!!!!!!! #######
  backgroundPageThumbsContent::_captureCurrentPage ${err}
  ${err.stack}
          #############################################
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        `);
        //We failed to get the manifest for some reason
        Cu.reportError(err);
      }
    } else {
      //Recover by doing screen grab as normal or do preview
      let ctx = canvas.getContext('2d');
      canvas.width = 300;
      canvas.height = 180;
      //let [sw, sh, scale] = [300, 180, content.devicePixelRatio]
      // Not a preview, capture desktop size
      //if (!this._currentCapture.isPreview) {
      let [sw, sh, scale] = PageThumbUtils.determineCropSize(content, canvas);
      //}
      ctx.save();
      ctx.scale(scale, scale);
      ctx.drawWindow(content, 0, 0, sw, sh,
                     PageThumbUtils.THUMBNAIL_BG_COLOR,
                     ctx.DRAWWINDOW_DO_NOT_FLUSH);
      ctx.restore();
    }
    capture.canvasDrawTime = new Date() - canvasDrawDate;
    canvas.toBlob(blob => {
      dump(`
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      Writing image data....
      ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      `);
      capture.imageBlob = new Blob([blob]);
      // Load about:blank to finish the capture and wait for onStateChange.
      this._loadAboutBlank();
    });
  }),

  _createThumbFromManifestPreview(aURL) {
    //Redo current capture as a preview
    let msg = {}
    msg.data = {
      id: this._currentCapture.id,
      url: aURL,
      isPreview: true,
    }
    this._onCapture(msg);
  },
  _createThumbFromManifestIcon: Task.async(function* (
    aCanvas,
    aManifest,
    thumbWidth = 300 * content.devicePixelRatio,
    thumbHeight = 180 * content.devicePixelRatio,
    bgColor = PageThumbUtils.THUMBNAIL_BG_COLOR
  ) {
    dump(
      `
%%%%%%%%%%%%%%%%%%%%%%
      backgroundPageThumbsContent::_createThumbFromManifestIcon
      STARTING ICON CAPTURE
%%%%%%%%%%%%%%%%%%%%%%
      `);
    const image = PageThumbUtils.createImage(content);
    const imageURLs = ImageObjectUtils.imagesToSrcset(
      aManifest.icons,
      content.devicePixelRatio
    );
    if (!imageURLs) {
      throw new Error('No icons found.')
    }
    dump(`
_createThumbFromManifestIcon: Loading ${imageURLs}
    `);
    image.width = thumbWidth;
    image.height = thumbHeight;
    image.sizes =  '100vw';
    //Race image loading and Error events
    dump(`
_createThumbFromManifestIcon: WAITING FOR IMAGE
    `);
    image.srcset = imageURLs;
    let event = yield Promise.race([
      awaitEvent(image, 'load'),
      awaitEvent(image, 'error'),
    ]);

    dump(`
_createThumbFromManifestIcon: GOT IMAGE ${image.currentSrc}
    ... CONTINUE...
    `);
    if (event.type === 'error') {
      throw new Error('Icon image failed to load.');
    }
    image.width = image.naturalWidth;
    image.height = image.naturalHeight;
    let ctx = aCanvas.getContext('2d');
    aCanvas.width = thumbWidth;
    aCanvas.height = thumbHeight;
    ctx.fillStyle = aManifest.icons_background_color || bgColor;
    ctx.fillRect(0, 0, aCanvas.width, aCanvas.height);
    let {
      shiftX, shiftY, scale
    } = determineImageScale(image, aCanvas);

    ctx.drawImage(
      image, 0, 0, image.naturalWidth, image.naturalHeight, shiftX, shiftY,
      image.naturalWidth / scale, image.naturalHeight / scale
    );
    dump(`
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        Finished creating icons:
          thumbWidth, thumbHeight: ${thumbWidth}, ${thumbHeight}
          image.naturalWidth: ${image.naturalWidth}
          image.naturalHeight: ${image.naturalHeight}
          shiftX, shiftY: ${shiftX} ${shiftY}
          scale: ${scale}
          image.naturalWidth / scale: ${image.naturalWidth / scale}
          image.naturalHeight / scale: ${image.naturalHeight / scale}
          Background-color: ${aManifest.icons_background_color || bgColor}
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    `)
    /**
     * Awaits for an event to fire and resolves a promise
     * when it does.
     * @param  {EventTarget} target The object that
     * @param  {DOMString} event  The name of the event to listen for.
     * @return {Promise} The promise to resolve when the event fires.
     */
    function awaitEvent(target, event) {
      return new Promise((resolve) => {
        target.addEventListener(event, function listener(ev) {
          target.removeEventListener(event, listener);
          resolve(ev);
        });
      });
    }

    function determineImageScale(aImage, aCanvas) {
      let hRatio = aImage.naturalWidth / aCanvas.width;
      let vRatio = aImage.naturalHeight / aCanvas.height;
      let scale = Math.max(Math.max(hRatio, vRatio), 1);
      let shiftX = (aCanvas.width - (aImage.naturalWidth / scale)) / 2;
      let shiftY = (aCanvas.height - (aImage.naturalHeight / scale)) / 2;
      return {
        scale: scale,
        shiftX: shiftX,
        shiftY: shiftY,
      };
    }
  }),

  _finishCurrentCapture: function () {
    let capture = this._currentCapture;
    let fileReader = Cc["@mozilla.org/files/filereader;1"].
                     createInstance(Ci.nsIDOMFileReader);
    fileReader.onloadend = () => {
      sendAsyncMessage("BackgroundPageThumbs:didCapture", {
        id: capture.id,
        imageData: fileReader.result,
        finalURL: capture.finalURL,
        telemetry: {
          CAPTURE_PAGE_LOAD_TIME_MS: capture.pageLoadTime,
          CAPTURE_CANVAS_DRAW_TIME_MS: capture.canvasDrawTime,
        },
      });
    };
    fileReader.readAsArrayBuffer(capture.imageBlob);
  },

  _failCurrentCapture: function (reason) {
    let capture = this._currentCapture;
    sendAsyncMessage("BackgroundPageThumbs:didCapture", {
      id: capture.id,
      failReason: reason,
    });
  },

  // We load about:blank to finish all captures, even canceled captures.  Two
  // reasons: GC the captured page, and ensure it can't possibly load any more
  // resources.
  _loadAboutBlank: function _loadAboutBlank() {
    this._webNav.loadURI("about:blank",
                         Ci.nsIWebNavigation.LOAD_FLAGS_STOP_CONTENT,
                         null, null, null);
  },

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebProgressListener,
    Ci.nsISupportsWeakReference,
    Ci.nsIObserver,
  ]),
};

backgroundPageThumbsContent.init();
