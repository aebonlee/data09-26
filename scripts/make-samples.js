// 가상 샘플 규정을 samples/ 에 파일로 씁니다:  node scripts/make-samples.js
// 글자 파일(.txt · .md)은 이 스크립트가 만들고, PDF · Word 는 같은 글을 헤드리스 브라우저 인쇄(page.pdf)와 python-docx 로 만들었습니다(docs/개발일지.md).
// 파일을 ② 지식 문서에 넣어 보면 「가상 샘플 규정으로 시작」과 같은 조각이 나와야 합니다(테스트로 확인).
const fs = require('fs');
const path = require('path');
const S = require('../js/sample-data.js');
const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
for (const d of S.DOCS) {
  if (!/\.(txt|md)$/.test(d.fileName)) continue;
  fs.writeFileSync(path.join(out, d.fileName), d.text + '\n');
  console.log('samples/' + d.fileName);
}
