/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set sw=2 ts=8 et ft=cpp : */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_DeviceChangeCallback_h
#define mozilla_DeviceChangeCallback_h

#include "mozilla/Mutex.h"
#include "nsTArray.h"

namespace mozilla {

class DeviceChangeCallback {
 public:
  virtual ~DeviceChangeCallback() = default;
  virtual void OnDeviceChange() = 0;
};

class DeviceChangeNotifier {
 public:
  DeviceChangeNotifier()
      : mCallbackMutex("mozilla::DeviceChangeCallback::mCallbackMutex") {}

  void NotifyDeviceChange() {
    MutexAutoLock lock(mCallbackMutex);
    for (DeviceChangeCallback* observer : mDeviceChangeCallbackList) {
      observer->OnDeviceChange();
    }
  }

  virtual int AddDeviceChangeCallback(DeviceChangeCallback* aCallback) {
    MutexAutoLock lock(mCallbackMutex);
    if (mDeviceChangeCallbackList.IndexOf(aCallback) ==
        mDeviceChangeCallbackList.NoIndex)
      mDeviceChangeCallbackList.AppendElement(aCallback);
    return 0;
  }

  int RemoveDeviceChangeCallback(DeviceChangeCallback* aCallback) {
    MutexAutoLock lock(mCallbackMutex);
    return RemoveDeviceChangeCallbackLocked(aCallback);
  }

  int RemoveDeviceChangeCallbackLocked(DeviceChangeCallback* aCallback) {
    mCallbackMutex.AssertCurrentThreadOwns();
    if (mDeviceChangeCallbackList.IndexOf(aCallback) !=
        mDeviceChangeCallbackList.NoIndex)
      mDeviceChangeCallbackList.RemoveElement(aCallback);
    return 0;
  }

  virtual ~DeviceChangeNotifier() = default;

 protected:
  nsTArray<DeviceChangeCallback*> mDeviceChangeCallbackList;
  Mutex mCallbackMutex;
};

}  // namespace mozilla

#endif  // mozilla_DeviceChangeCallback_h
