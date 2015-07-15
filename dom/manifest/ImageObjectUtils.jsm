/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */
'use strict';
this.EXPORTED_SYMBOLS = ['ImageObjectUtils'];

this.ImageObjectUtils = {
  /**
   * Converts image.
   * @param  {Array}  imageObjects A list of image objects to convert into
   *                               srcset.
   * @param  {Number} dpr      DPR to reason against.
   * @return {String}          A string that can be used.
   */
  imagesToSrcset(imageObjects = [], dpr = 1) {
    if (!imageObjects.length) {
      return '';
    }
    //Prefer 'any', specially if dpr matches
    const any = imageObjects.filter(
      image => image.sizes === 'any' && image.density >= dpr
    );
    const listToUse = (any.length) ? any : imageObjects;
    const srcArray = listToUse
      .map(image => `${image.src} ${image.density}x`);
    const srcSet = new Set(srcArray);
    return Array.from(srcSet).join(', ');
  },

  toResponsiveImage(contentWindow, imageObjects) {
    
  }
};
