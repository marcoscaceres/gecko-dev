/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["GeckoViewContentBlockingController"];

const { GeckoViewUtils } = ChromeUtils.import(
  "resource://gre/modules/GeckoViewUtils.jsm"
);
const { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

ChromeUtils.defineModuleGetter(
  this,
  "E10SUtils",
  "resource://gre/modules/E10SUtils.jsm"
);

XPCOMUtils.defineLazyModuleGetters(this, {
  ContentBlockingAllowList:
    "resource://gre/modules/ContentBlockingAllowList.jsm",
  Services: "resource://gre/modules/Services.jsm",
});

// eslint-disable-next-line no-unused-vars
const { debug, warn } = GeckoViewUtils.initLogging(
  "GeckoViewContentBlockingController"
);

const GeckoViewContentBlockingController = {
  // Bundle event handler.
  onEvent(aEvent, aData, aCallback) {
    debug`onEvent: event=${aEvent}, data=${aData}`;

    switch (aEvent) {
      case "ContentBlocking:AddException": {
        const sessionWindow = Services.ww.getWindowByName(
          aData.sessionId,
          this.window
        );
        ContentBlockingAllowList.add(sessionWindow.browser);
        break;
      }

      case "ContentBlocking:RemoveException": {
        const sessionWindow = Services.ww.getWindowByName(
          aData.sessionId,
          this.window
        );
        ContentBlockingAllowList.remove(sessionWindow.browser);
        break;
      }

      case "ContentBlocking:CheckException": {
        const sessionWindow = Services.ww.getWindowByName(
          aData.sessionId,
          this.window
        );
        const res = ContentBlockingAllowList.includes(sessionWindow.browser);
        aCallback.onSuccess(res);
        break;
      }

      case "ContentBlocking:SaveList": {
        const list = ContentBlockingAllowList.getAllowListedPrincipals();
        const principals = list.map(p => E10SUtils.serializePrincipal(p));
        const uris = list.map(p => (p.URI ? p.URI.displaySpec : null));
        aCallback.onSuccess({
          principals,
          uris,
        });
        break;
      }

      case "ContentBlocking:RestoreList": {
        const principals = aData.principals.map(p =>
          E10SUtils.deserializePrincipal(p)
        );
        ContentBlockingAllowList.wipeLists();
        ContentBlockingAllowList.addAllowListPrincipals(principals);
        break;
      }

      case "ContentBlocking:ClearList": {
        ContentBlockingAllowList.wipeLists();
        break;
      }
    }
  },
};
