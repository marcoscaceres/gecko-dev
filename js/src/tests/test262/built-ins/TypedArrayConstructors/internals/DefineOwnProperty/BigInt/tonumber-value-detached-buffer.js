// Copyright (C) 2017 Mozilla Corporation. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-integer-indexed-exotic-objects-defineownproperty-p-desc
description: >
    Defining a typed array element to a value that, when converted to the typed
    array element type, detaches the typed array's underlying buffer, should
    throw a TypeError and not modify the typed array.
info: |
  9.4.5.3 [[DefineOwnProperty]] ( P, Desc )

  ...
  3. If Type(P) is String, then
    a. Let numericIndex be ! CanonicalNumericIndexString(P).
    b. If numericIndex is not undefined, then
      ...
      x. If Desc has a [[Value]] field, then
        1. Let value be Desc.[[Value]].
        2. Return ? IntegerIndexedElementSet(O, numericIndex, value).
  ...

  9.4.5.9 IntegerIndexedElementSet ( O, index, value )

  ...
  15. Perform SetValueInBuffer(buffer, indexedPosition, elementType, numValue).
  16. Return true.
includes: [testBigIntTypedArray.js, detachArrayBuffer.js]
features: [BigInt, Reflect, TypedArray]
---*/

testWithBigIntTypedArrayConstructors(function(TA) {
  var ta = new TA([17n]);

  var desc =
    {
      value: {
        valueOf: function() {
          $262.detachArrayBuffer(ta.buffer);
          return 42n;
        }
      }
    };

  assert.throws(TypeError, function() {
    Reflect.defineProperty(ta, 0, desc);
  },
  "detaching a ArrayBuffer during defining an element of a typed array " +
  "viewing it should throw");

  assert.throws(TypeError, function() {
    ta[0];
  });
});


reportCompare(0, 0);
