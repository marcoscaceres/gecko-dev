/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  createContextMenu,
} = require("devtools/client/webconsole/utils/context-menu");

const {
  createEditContextMenu,
} = require("devtools/client/framework/toolbox-context-menu");

function setupServiceContainer({
  webConsoleUI,
  hud,
  toolbox,
  webConsoleWrapper,
}) {
  const serviceContainer = {
    openContextMenu: (event, message) =>
      createContextMenu(event, message, webConsoleWrapper),

    openEditContextMenu: event => {
      const { screenX, screenY } = event;
      const menu = createEditContextMenu(window, "webconsole-menu");
      // Emit the "menu-open" event for testing.
      menu.once("open", () => webConsoleWrapper.emit("menu-open"));
      menu.popup(screenX, screenY, hud.chromeWindow.document);
    },

    // NOTE these methods are proxied currently because the
    // service container is passed down the tree. These methods should eventually
    // be moved to redux actions.
    recordTelemetryEvent: (event, extra = {}) => hud.recordEvent(event, extra),
    openLink: (url, e) => hud.openLink(url, e),
    openNodeInInspector: grip => hud.openNodeInInspector(grip),
    getInputSelection: () => hud.getInputSelection(),
    onViewSource: frame => hud.viewSource(frame.url, frame.line),
    resendNetworkRequest: requestId => hud.resendNetworkRequest(requestId),
    focusInput: () => hud.focusInput(),
    setInputValue: value => hud.setInputValue(value),
    canRewind: () => hud.canRewind(),
    onMessageHover: (type, message) =>
      webConsoleUI.onMessageHover(type, message),
    getLongString: grip => webConsoleUI.getLongString(grip),
    getJsTermTooltipAnchor: () => webConsoleUI.getJsTermTooltipAnchor(),
    emitEvent: (event, value) => webConsoleUI.emit(event, value),
    attachRefToWebConsoleUI: (id, node) => webConsoleUI.attachRef(id, node),
    requestData: (id, type) => webConsoleWrapper.requestData(id, type),
    createElement: nodename => webConsoleWrapper.createElement(nodename),
  };

  if (toolbox) {
    const { highlight, unhighlight } = toolbox.getHighlighter(true);

    Object.assign(serviceContainer, {
      sourceMapService: toolbox.sourceMapURLService,
      highlightDomElement: highlight,
      unHighlightDomElement: unhighlight,
      jumpToExecutionPoint: executionPoint =>
        toolbox.threadFront.timeWarp(executionPoint),
      onViewSourceInDebugger: frame => hud.onViewSourceInDebugger(frame),
      onViewSourceInStyleEditor: frame => hud.onViewSourceInStyleEditor(frame),
      onViewSourceInScratchpad: frame => hud.onViewSourceInScratchpad(frame),
    });
  }

  return serviceContainer;
}

module.exports.setupServiceContainer = setupServiceContainer;
