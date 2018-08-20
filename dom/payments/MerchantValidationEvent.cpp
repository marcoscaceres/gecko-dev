/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/MerchantValidationEvent.h"
#include "nsNetCID.h"
#include "mozilla/dom/PaymentRequest.h"
#include "mozilla/dom/Location.h"
#include "mozilla/dom/URL.h"
#include "nsIURI.h"

namespace mozilla {
namespace dom {

NS_IMPL_CYCLE_COLLECTION_INHERITED(MerchantValidationEvent, Event, mRequest)

NS_IMPL_CYCLE_COLLECTION_TRACE_BEGIN_INHERITED(MerchantValidationEvent, Event)
NS_IMPL_CYCLE_COLLECTION_TRACE_END

NS_INTERFACE_MAP_BEGIN_CYCLE_COLLECTION(MerchantValidationEvent)
NS_INTERFACE_MAP_END_INHERITING(Event)

NS_IMPL_ADDREF_INHERITED(MerchantValidationEvent, Event)
NS_IMPL_RELEASE_INHERITED(MerchantValidationEvent, Event)

already_AddRefed<MerchantValidationEvent>
MerchantValidationEvent::Constructor(
  EventTarget* aOwner,
  const nsAString& aType,
  const MerchantValidationEventInit& aEventInitDict)
{
  RefPtr<MerchantValidationEvent> e = new MerchantValidationEvent(aOwner);
  bool trusted = e->Init(aOwner);
  e->InitEvent(aType, aEventInitDict.mBubbles, aEventInitDict.mCancelable);
  e->SetTrusted(trusted);
  e->SetComposed(aEventInitDict.mComposed);
  return e.forget();
}

already_AddRefed<MerchantValidationEvent>
MerchantValidationEvent::Constructor(
  const GlobalObject& aGlobal,
  const nsAString& aType,
  const MerchantValidationEventInit& aEventInitDict,
  ErrorResult& aRv)
{
  nsCOMPtr<EventTarget> owner = do_QueryInterface(aGlobal.GetAsSupports());
  RefPtr<MerchantValidationEvent> event =
    Constructor(owner, aType, aEventInitDict);

  nsCOMPtr<nsPIDOMWindowInner> window = do_QueryInterface(owner);
  auto doc = window->GetExtantDoc();
  auto principal = doc->NodePrincipal();
  MOZ_ASSERT(principal);

  nsCOMPtr<nsIURI> baseURI;
  principal->GetURI(getter_AddRefs(baseURI));

  nsAutoCString baseURLStr;
  nsresult rv = baseURI->GetSpec(baseURLStr);
  NS_ENSURE_SUCCESS(rv, nullptr);

  NS_ConvertUTF8toUTF16 baseUTF16(baseURLStr);
  Optional<nsAString> optionalBase;
  optionalBase = &baseUTF16;

  RefPtr<URL> url =
    URL::Constructor(aGlobal, aEventInitDict.mValidationURL, optionalBase, aRv);

  if (aRv.Failed()) {
    return nullptr;
  }

  nsString href;
  url->GetHref(href);
  event->SetValidationURL(href);
  return event.forget();
}

MerchantValidationEvent::MerchantValidationEvent(EventTarget* aOwner)
  : Event(aOwner, nullptr, nullptr)
  , mWaitForUpdate(false)
  , mRequest(nullptr)
{
  MOZ_ASSERT(aOwner);
}

void
MerchantValidationEvent::ResolvedCallback(JSContext* aCx,
                                          JS::Handle<JS::Value> aValue)
{
  MOZ_ASSERT(aCx);
  MOZ_ASSERT(mRequest);

  if (!mWaitForUpdate) {
    return;
  }

  // TODO: If we eventually support merchant validation
  // we would verify `aValue` here.
  mRequest->AbortUpdate(NS_ERROR_DOM_NOT_SUPPORTED_ERR, false);

  mWaitForUpdate = false;
  mRequest->SetUpdating(false);
}

void
MerchantValidationEvent::RejectedCallback(JSContext* aCx,
                                          JS::Handle<JS::Value> aValue)
{
  MOZ_ASSERT(mRequest);

  mRequest->AbortUpdate(NS_ERROR_DOM_ABORT_ERR, false);
  mWaitForUpdate = false;
  mRequest->SetUpdating(false);
}

void
MerchantValidationEvent::Complete(Promise& aPromise, ErrorResult& aRv)
{
  if (!IsTrusted()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }

  MOZ_ASSERT(mRequest);

  if (mWaitForUpdate || !mRequest->ReadyForUpdate()) {
    aRv.Throw(NS_ERROR_DOM_INVALID_STATE_ERR);
    return;
  }

  aPromise.AppendNativeHandler(this);

  StopPropagation();
  StopImmediatePropagation();
  mWaitForUpdate = true;
  mRequest->SetUpdating(true);
}

void
MerchantValidationEvent::SetRequest(PaymentRequest* aRequest)
{
  MOZ_ASSERT(IsTrusted());
  MOZ_ASSERT(!mRequest);
  MOZ_ASSERT(aRequest);

  mRequest = aRequest;
}

void
MerchantValidationEvent::GetValidationURL(nsAString& aValidationURL)
{
  aValidationURL.Assign(mValidationURL);
}

void
MerchantValidationEvent::SetValidationURL(nsAString& aValidationURL)
{
  mValidationURL.Assign(aValidationURL);
}

MerchantValidationEvent::~MerchantValidationEvent() {}

JSObject*
MerchantValidationEvent::WrapObjectInternal(JSContext* aCx,
                                            JS::Handle<JSObject*> aGivenProto)
{
  return MerchantValidationEvent_Binding::Wrap(aCx, this, aGivenProto);
}

} // namespace dom
} // namespace mozilla
