#!/bin/bash

# Entry Turbo 빌드 스크립트
# 사용법: ./build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"

echo "🚀 Entry Turbo 빌드 시작..."

# dist 디렉토리 생성
mkdir -p "$DIST_DIR"

# 개발 버전 복사
cp "$SRC_DIR/entry-turbo.js" "$DIST_DIR/entry-turbo.js"
echo "✅ entry-turbo.js 복사 완료"

# 압축 버전 생성 (terser가 설치되어 있는 경우)
if command -v npx &> /dev/null; then
    # terser로 압축
    npx terser "$SRC_DIR/entry-turbo.js" \
        --compress --mangle \
        --output "$DIST_DIR/entry-turbo.min.js" \
        2>/dev/null || {
        # terser가 없으면 단순 복사
        echo "⚠️  terser가 설치되지 않았습니다. 압축 없이 복사합니다."
        cp "$SRC_DIR/entry-turbo.js" "$DIST_DIR/entry-turbo.min.js"
    }
else
    cp "$SRC_DIR/entry-turbo.js" "$DIST_DIR/entry-turbo.min.js"
fi

echo "✅ entry-turbo.min.js 생성 완료"

# 파일 크기 출력
echo ""
echo "📦 빌드 결과:"
ls -lh "$DIST_DIR"/*.js

echo ""
echo "🎉 빌드 완료!"
