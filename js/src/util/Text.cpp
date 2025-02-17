/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * vim: set ts=8 sts=2 et sw=2 tw=80:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "util/Text.h"

#include "mozilla/Assertions.h"
#include "mozilla/Maybe.h"
#include "mozilla/PodOperations.h"
#include "mozilla/Utf8.h"

#include <stddef.h>
#include <stdint.h>

#include "gc/GC.h"
#include "js/GCAPI.h"
#include "util/Unicode.h"
#include "vm/JSContext.h"
#include "vm/StringType.h"

using namespace JS;
using namespace js;

using js::gc::AutoSuppressGC;
using mozilla::DecodeOneUtf8CodePoint;
using mozilla::IsAscii;
using mozilla::Maybe;
using mozilla::PodCopy;
using mozilla::Utf8Unit;

template <typename CharT>
const CharT* js_strchr_limit(const CharT* s, char16_t c, const CharT* limit) {
  while (s < limit) {
    if (*s == c) {
      return s;
    }
    s++;
  }
  return nullptr;
}

template const Latin1Char* js_strchr_limit(const Latin1Char* s, char16_t c,
                                           const Latin1Char* limit);

template const char16_t* js_strchr_limit(const char16_t* s, char16_t c,
                                         const char16_t* limit);

int32_t js_fputs(const char16_t* s, FILE* f) {
  while (*s != 0) {
    if (fputwc(wchar_t(*s), f) == WEOF) {
      return WEOF;
    }
    s++;
  }
  return 1;
}

UniqueChars js::DuplicateStringToArena(arena_id_t destArenaId, JSContext* cx,
                                       const char* s) {
  return DuplicateStringToArena(destArenaId, cx, s, strlen(s));
}

UniqueChars js::DuplicateStringToArena(arena_id_t destArenaId, JSContext* cx,
                                       const char* s, size_t n) {
  auto ret = cx->make_pod_array<char>(n + 1, destArenaId);
  if (!ret) {
    return nullptr;
  }
  PodCopy(ret.get(), s, n);
  ret[n] = '\0';
  return ret;
}

UniqueTwoByteChars js::DuplicateStringToArena(arena_id_t destArenaId,
                                              JSContext* cx,
                                              const char16_t* s) {
  return DuplicateStringToArena(destArenaId, cx, s, js_strlen(s));
}

UniqueTwoByteChars js::DuplicateStringToArena(arena_id_t destArenaId,
                                              JSContext* cx, const char16_t* s,
                                              size_t n) {
  auto ret = cx->make_pod_array<char16_t>(n + 1, destArenaId);
  if (!ret) {
    return nullptr;
  }
  PodCopy(ret.get(), s, n);
  ret[n] = '\0';
  return ret;
}

UniqueChars js::DuplicateStringToArena(arena_id_t destArenaId, const char* s) {
  return DuplicateStringToArena(destArenaId, s, strlen(s));
}

UniqueChars js::DuplicateStringToArena(arena_id_t destArenaId, const char* s,
                                       size_t n) {
  UniqueChars ret(js_pod_arena_malloc<char>(destArenaId, n + 1));
  if (!ret) {
    return nullptr;
  }
  PodCopy(ret.get(), s, n);
  ret[n] = '\0';
  return ret;
}

UniqueTwoByteChars js::DuplicateStringToArena(arena_id_t destArenaId,
                                              const char16_t* s) {
  return DuplicateStringToArena(destArenaId, s, js_strlen(s));
}

UniqueTwoByteChars js::DuplicateStringToArena(arena_id_t destArenaId,
                                              const char16_t* s, size_t n) {
  UniqueTwoByteChars ret(js_pod_arena_malloc<char16_t>(destArenaId, n + 1));
  if (!ret) {
    return nullptr;
  }
  PodCopy(ret.get(), s, n);
  ret[n] = '\0';
  return ret;
}

UniqueChars js::DuplicateString(JSContext* cx, const char* s, size_t n) {
  return DuplicateStringToArena(js::MallocArena, cx, s, n);
}

UniqueChars js::DuplicateString(JSContext* cx, const char* s) {
  return DuplicateStringToArena(js::MallocArena, cx, s);
}

UniqueTwoByteChars js::DuplicateString(JSContext* cx, const char16_t* s) {
  return DuplicateStringToArena(js::MallocArena, cx, s);
}

UniqueTwoByteChars js::DuplicateString(JSContext* cx, const char16_t* s,
                                       size_t n) {
  return DuplicateStringToArena(js::MallocArena, cx, s, n);
}

UniqueChars js::DuplicateString(const char* s) {
  return DuplicateStringToArena(js::MallocArena, s);
}

UniqueChars js::DuplicateString(const char* s, size_t n) {
  return DuplicateStringToArena(js::MallocArena, s, n);
}

UniqueTwoByteChars js::DuplicateString(const char16_t* s) {
  return DuplicateStringToArena(js::MallocArena, s);
}

UniqueTwoByteChars js::DuplicateString(const char16_t* s, size_t n) {
  return DuplicateStringToArena(js::MallocArena, s, n);
}

char16_t* js::InflateString(JSContext* cx, const char* bytes, size_t length) {
  char16_t* chars = cx->pod_malloc<char16_t>(length + 1);
  if (!chars) {
    return nullptr;
  }
  CopyAndInflateChars(chars, bytes, length);
  chars[length] = '\0';
  return chars;
}

/*
 * Convert one UCS-4 char and write it into a UTF-8 buffer, which must be at
 * least 4 bytes long.  Return the number of UTF-8 bytes of data written.
 */
uint32_t js::OneUcs4ToUtf8Char(uint8_t* utf8Buffer, uint32_t ucs4Char) {
  MOZ_ASSERT(ucs4Char <= unicode::NonBMPMax);

  if (ucs4Char < 0x80) {
    utf8Buffer[0] = uint8_t(ucs4Char);
    return 1;
  }

  uint32_t a = ucs4Char >> 11;
  uint32_t utf8Length = 2;
  while (a) {
    a >>= 5;
    utf8Length++;
  }

  MOZ_ASSERT(utf8Length <= 4);

  uint32_t i = utf8Length;
  while (--i) {
    utf8Buffer[i] = uint8_t((ucs4Char & 0x3F) | 0x80);
    ucs4Char >>= 6;
  }

  utf8Buffer[0] = uint8_t(0x100 - (1 << (8 - utf8Length)) + ucs4Char);
  return utf8Length;
}

size_t js::PutEscapedStringImpl(char* buffer, size_t bufferSize,
                                GenericPrinter* out, JSLinearString* str,
                                uint32_t quote) {
  size_t len = str->length();
  AutoCheckCannotGC nogc;
  return str->hasLatin1Chars()
             ? PutEscapedStringImpl(buffer, bufferSize, out,
                                    str->latin1Chars(nogc), len, quote)
             : PutEscapedStringImpl(buffer, bufferSize, out,
                                    str->twoByteChars(nogc), len, quote);
}

template <typename CharT>
size_t js::PutEscapedStringImpl(char* buffer, size_t bufferSize,
                                GenericPrinter* out, const CharT* chars,
                                size_t length, uint32_t quote) {
  enum {
    STOP,
    FIRST_QUOTE,
    LAST_QUOTE,
    CHARS,
    ESCAPE_START,
    ESCAPE_MORE
  } state;

  MOZ_ASSERT(quote == 0 || quote == '\'' || quote == '"');
  MOZ_ASSERT_IF(!buffer, bufferSize == 0);
  MOZ_ASSERT_IF(out, !buffer);

  if (bufferSize == 0) {
    buffer = nullptr;
  } else {
    bufferSize--;
  }

  const CharT* charsEnd = chars + length;
  size_t n = 0;
  state = FIRST_QUOTE;
  unsigned shift = 0;
  unsigned hex = 0;
  unsigned u = 0;
  char c = 0; /* to quell GCC warnings */

  for (;;) {
    switch (state) {
      case STOP:
        goto stop;
      case FIRST_QUOTE:
        state = CHARS;
        goto do_quote;
      case LAST_QUOTE:
        state = STOP;
      do_quote:
        if (quote == 0) {
          continue;
        }
        c = (char)quote;
        break;
      case CHARS:
        if (chars == charsEnd) {
          state = LAST_QUOTE;
          continue;
        }
        u = *chars++;
        if (u < ' ') {
          if (u != 0) {
            const char* escape = strchr(js_EscapeMap, (int)u);
            if (escape) {
              u = escape[1];
              goto do_escape;
            }
          }
          goto do_hex_escape;
        }
        if (u < 127) {
          if (u == quote || u == '\\') {
            goto do_escape;
          }
          c = (char)u;
        } else if (u < 0x100) {
          goto do_hex_escape;
        } else {
          shift = 16;
          hex = u;
          u = 'u';
          goto do_escape;
        }
        break;
      do_hex_escape:
        shift = 8;
        hex = u;
        u = 'x';
      do_escape:
        c = '\\';
        state = ESCAPE_START;
        break;
      case ESCAPE_START:
        MOZ_ASSERT(' ' <= u && u < 127);
        c = (char)u;
        state = ESCAPE_MORE;
        break;
      case ESCAPE_MORE:
        if (shift == 0) {
          state = CHARS;
          continue;
        }
        shift -= 4;
        u = 0xF & (hex >> shift);
        c = (char)(u + (u < 10 ? '0' : 'A' - 10));
        break;
    }
    if (buffer) {
      MOZ_ASSERT(n <= bufferSize);
      if (n != bufferSize) {
        buffer[n] = c;
      } else {
        buffer[n] = '\0';
        buffer = nullptr;
      }
    } else if (out) {
      if (!out->put(&c, 1)) {
        return size_t(-1);
      }
    }
    n++;
  }
stop:
  if (buffer) {
    buffer[n] = '\0';
  }
  return n;
}

bool js::ContainsFlag(const char* str, const char* flag) {
  size_t flaglen = strlen(flag);
  const char* index = strstr(str, flag);
  while (index) {
    if ((index == str || index[-1] == ',') &&
        (index[flaglen] == 0 || index[flaglen] == ',')) {
      return true;
    }
    index = strstr(index + flaglen, flag);
  }
  return false;
}

template size_t js::PutEscapedStringImpl(char* buffer, size_t bufferSize,
                                         GenericPrinter* out,
                                         const Latin1Char* chars, size_t length,
                                         uint32_t quote);

template size_t js::PutEscapedStringImpl(char* buffer, size_t bufferSize,
                                         GenericPrinter* out, const char* chars,
                                         size_t length, uint32_t quote);

template size_t js::PutEscapedStringImpl(char* buffer, size_t bufferSize,
                                         GenericPrinter* out,
                                         const char16_t* chars, size_t length,
                                         uint32_t quote);

template size_t js::PutEscapedString(char* buffer, size_t bufferSize,
                                     const Latin1Char* chars, size_t length,
                                     uint32_t quote);

template size_t js::PutEscapedString(char* buffer, size_t bufferSize,
                                     const char16_t* chars, size_t length,
                                     uint32_t quote);

size_t js::unicode::CountCodePoints(const Utf8Unit* begin,
                                    const Utf8Unit* end) {
  MOZ_ASSERT(begin <= end);

  size_t count = 0;
  const Utf8Unit* ptr = begin;
  while (ptr < end) {
    count++;

    Utf8Unit lead = *ptr++;
    if (IsAscii(lead)) {
      continue;
    }

#ifdef DEBUG
    Maybe<char32_t> cp =
#endif
        DecodeOneUtf8CodePoint(lead, &ptr, end);
    MOZ_ASSERT(cp.isSome());
  }
  MOZ_ASSERT(ptr == end, "bad code unit count in line?");

  return count;
}

size_t js::unicode::CountCodePoints(const char16_t* begin,
                                    const char16_t* end) {
  MOZ_ASSERT(begin <= end);

  size_t count = 0;

  const char16_t* ptr = begin;
  while (ptr < end) {
    count++;

    if (!IsLeadSurrogate(*ptr++)) {
      continue;
    }

    if (ptr < end && IsTrailSurrogate(*ptr)) {
      ptr++;
    }
  }
  MOZ_ASSERT(ptr == end, "should have consumed the full range");

  return count;
}
