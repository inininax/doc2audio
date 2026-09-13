# 웹에서 모델 저장 위치 지정하기

조사일: 2026-09-13. 배포된 HTTPS 사이트에 일반 사용자가 접속하는 상황을 기준으로 합니다.

**사용자가 선택한 실제 로컬 폴더에 모델을 저장하고 웹에서 관리하는 기능은 만들 수 있습니다. 현재 doc2audio에는 아직 구현하지 않았습니다.**

## 현재 구현과 추가 개발 가능 범위

| 방식 | 모델이 저장되는 곳 | 사용자가 저장 폴더 지정 | 사이트 데이터 삭제 시 |
| --- | --- | --- | --- |
| 현재 웹: IndexedDB | 각 사용자 PC의 브라우저 전용 저장소 | 불가 | 모델·문서·작업 기록 삭제 |
| 추가 개발: File System Access | 사용자가 선택창에서 고른 실제 폴더 | 가능, 지원 브라우저에서 선택·권한 허용 필요 | 폴더의 실제 파일과 사이트가 기억하는 연결 정보는 별개 |
| 대안 기술: OPFS | 브라우저가 관리하는 사이트 전용 파일 시스템 | 불가 | OPFS 파일도 삭제 |

현재 웹은 `doc2audio-browser` IndexedDB에 모델과 작업을 저장합니다. 운영체제의 실제 저장 경로는 사용자 OS·브라우저·프로필·사이트 주소에 따라 달라집니다. 개발자의 `.models/` 폴더로 일반 사용자의 모델을 받는 구조가 아닙니다. 구현 근거는 [브라우저 저장 코드](../apps/web/src/browser/storage.ts), [모델 다운로드 코드](../apps/web/src/browser/download.ts), [브라우저 실행 문서](browser-runtime.md)입니다.

현재 웹의 모델 화면에서도 모델 정보와 설치 상태를 확인하고 다운로드할 수 있습니다. 없는 기능은 **사용자 폴더를 직접 지정해 모델 파일을 보관·연결하는 기능**입니다.

OPFS는 폴더처럼 읽고 쓸 수 있어도 탐색기나 Finder에서 사용자가 지정하는 폴더가 아닙니다. 사이트 데이터 삭제 대상이고 브라우저 저장 용량 제한도 적용됩니다. [MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

## 실제 폴더 방식을 개발하면 가능한 흐름

아래는 추가 개발안이며 현재 사용 절차가 아닙니다.

| 순서 | 사용자가 하는 일 | 웹 내부 동작 |
| --- | --- | --- |
| 1 | ‘모델 저장 폴더 선택’을 누르고 폴더 지정 | `showDirectoryPicker()`로 폴더 접근 권한을 받고 연결 정보(핸들)를 기억 |
| 2 | 모델 다운로드 | 선택한 폴더 아래 모델 파일과 명세 파일(manifest: 모델 ID·리비전·파일 목록·크기·SHA-256)을 저장 |
| 3 | 문서 변환 | 폴더에서 모델을 읽어 RAM에 불러온 뒤 사용자 PC의 브라우저에서 음성 생성 |
| 4 | 나중에 다시 접속 | 폴더 접근 권한과 파일 상태를 확인하고 정상 파일 재사용. 필요한 경우 폴더 재연결 |

선택한 폴더의 파일 목록 조회·생성·읽기·쓰기를 지원하므로 모델 설치 상태·용량·버전 확인과 삭제 UI도 구현할 수 있습니다. [Chrome: File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

모델 저장 위치를 바꿔도 실행 가능한 모델 종류가 저절로 늘어나지는 않습니다. 현재 브라우저 엔진은 Supertonic 3용이며 Qwen3의 Python/MLX 모델 파일을 폴더에서 읽는 것만으로 브라우저 실행이 가능해지지는 않습니다.

## 브라우저와 권한 조건

- 배포 사이트는 HTTPS여야 하며 사용자가 버튼을 누르는 등의 직접 조작으로 폴더 선택창을 열어야 합니다. 운영체제 주요 폴더는 브라우저가 선택을 거절할 수 있습니다. [MDN: showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- 조사 시점의 MDN 호환성 데이터는 데스크톱 Chrome·Edge 86 이상, Android Chrome 132 이상을 지원으로 표시합니다. Firefox와 Safari는 `showDirectoryPicker()`를 지원하지 않습니다. 실제 UI는 브라우저 이름만 확인하지 않고 API 지원 여부를 검사해야 합니다. [MDN 호환성 원본](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)
- `C:\Models`나 `/Users/.../Models` 같은 **경로 문자열을 웹 입력란에 적는 것만으로 폴더 접근 권한을 얻을 수 없습니다.** 선택창 또는 이미 허용된 폴더 핸들이 필요합니다. `startIn`도 임의 절대 경로가 아니라 기존 핸들이나 `documents` 같은 정해진 위치를 받습니다. [File System Access 명세](https://wicg.github.io/file-system-access/#api-filepickeroptions)
- 웹은 선택한 폴더 이름과 그 아래 상대 경로를 다룹니다. 이 API에 OS 전체 절대 경로를 반환하는 기능은 없습니다. UI에는 ‘선택한 폴더 이름 / 모델 폴더’를 표시하는 구성이 맞습니다. [MDN: resolve](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/resolve)

## 다시 열기·삭제·파일 변경

폴더 핸들은 IndexedDB에 저장할 수 있지만 핸들이 남아 있다는 사실과 현재 읽기·쓰기 권한이 있다는 사실은 다릅니다. 재접속 때 `queryPermission()`으로 확인하고 필요하면 사용자 조작 후 `requestPermission()`으로 다시 요청해야 합니다. Chrome에는 사용자가 매 방문 접근을 허용하는 선택지도 있지만 영구 허용을 전제로 구현해서는 안 됩니다. [Chrome: 지속 접근 권한](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)

**선택한 실제 폴더에 쓴 파일은 브라우저 사이트 데이터와 별개입니다.** 이 저장 구조에서는 사이트 데이터를 지워도 폴더의 모델 파일은 남고 IndexedDB에 저장한 핸들·모델 목록·작업 기록은 지워집니다. 같은 폴더를 다시 선택해 모델 정보를 읽고 파일을 검증하면 재다운로드를 피할 수 있도록 설계할 수 있습니다. 이는 실제 파일과 사이트 저장소의 분리에 따른 설계 결론이며, 해당 기능을 구현하거나 삭제 동작을 실기기로 검증한 결과는 아닙니다. [Chrome: 실제 파일 접근과 핸들 보관](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [MDN: 사이트 저장소 삭제](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data)

사용자가 파일을 이동·삭제·수정했을 때도 처리해야 합니다. 모델 정보 파일만 믿지 않고 앱에 고정한 모델 명세와 크기·해시를 비교하고, 누락·변경된 파일을 다시 안내하는 방식이 적합합니다. 다른 프로그램이 파일을 바꾸면 기존 `File` 객체를 다시 얻어야 할 수도 있습니다. [Chrome: 로컬 파일 읽기](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#read_a_file_from_the_local_file_system)

모델만 실제 폴더로 옮긴다면 작업 기록은 계속 브라우저 저장소에 남습니다. 사이트 데이터 삭제 후에도 작업 이어하기까지 보존하려면 원문·설정·완료 음성 구간을 함께 폴더에 저장하는 별도 개발이 필요합니다.

## 이 프로젝트에 맞는 방향

기본 IndexedDB 저장을 유지하고, 지원 브라우저에 한해 **‘내 폴더에 모델 보관’**을 선택 기능으로 추가하는 방식을 권장합니다. 모델 종류 확대와는 독립된 작업입니다. OPFS로 바꾸는 것만으로는 사용자가 원하는 폴더 지정이나 사이트 데이터 삭제 후 모델 보존을 해결하지 못합니다.

지금 바로 폴더를 지정해 개인적으로 쓰려면 [로컬 실행의 폴더 지정 안내](local-usage.md#모델과-작업을-원하는-폴더에-저장하기)를 따르면 됩니다. Python CLI·서버는 브라우저 저장소와 분리된 실제 폴더의 모델을 사용합니다.

이 문서는 공식 문서 조사와 현재 코드 확인 결과입니다. 폴더 선택 API 구현·브라우저별 실기기 검증은 수행하지 않았습니다.
