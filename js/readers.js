/* 문서 파일 → 글자 (브라우저 안에서만 읽습니다. 파일은 어디로도 보내지 않습니다)
   PDF  : vendor/pdf.min.js (pdf.js). file:// 에서는 Worker 가 막히므로 worker 스크립트를 일반 스크립트로 먼저 넣어 화면 스레드에서 돌립니다(data09-08 방식).
          한글 CID 글꼴 표는 vendor/cmaps/ — 온라인(https)에서만 불러집니다. 글자 층이 없는 스캔 PDF 는 읽지 못합니다(OCR 은 2단계).
   DOCX : vendor/jszip.min.js 로 word/document.xml 을 꺼내 RegLogic.docxXmlToText 로 문단·표를 줄로.
   TXT·MD: UTF-8(깨지면 EUC-KR 로 한 번 더). HWP 는 읽지 못하니 PDF 나 DOCX 로 저장해 넣어 주세요. */
(function (root) {
  'use strict';
  var L = root.RegLogic;
  var pdfLoading = null;
  function addScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = src;
      s.onload = ok; s.onerror = function () { bad(new Error('PDF 읽기 도구(' + src + ')를 불러오지 못했습니다. 폴더째 받았는지 확인해 주세요.')); };
      document.head.appendChild(s);
    });
  }
  function withPdf() {
    if (root.pdfjsLib && root.pdfjsWorker) return Promise.resolve(root.pdfjsLib);
    if (!pdfLoading) pdfLoading = addScript('vendor/pdf.worker.min.js').then(function () { return addScript('vendor/pdf.min.js'); }).then(function () {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      return root.pdfjsLib;
    }, function (e) { pdfLoading = null; throw e; });
    return pdfLoading;
  }
  function readBuf(file) {
    return new Promise(function (ok, bad) {
      var fr = new FileReader();
      fr.onload = function () { ok(fr.result); };
      fr.onerror = function () { bad(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function pdfText(buf) {
    return withPdf().then(function (lib) {
      var opts = { data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true };
      if (location.protocol !== 'file:') { opts.cMapUrl = 'vendor/cmaps/'; opts.cMapPacked = true; }
      return lib.getDocument(opts).promise;
    }).then(function (doc) {
      var pages = [], p = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) (function (n) {
        p = p.then(function () { return doc.getPage(n); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          pages.push(tc.items.map(function (it) { return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }; }));
        });
      })(i);
      return p.then(function () {
        var text = L.pdfPagesToText(pages);
        doc.destroy();
        if (!text.replace(/\[\[p\.\d+\]\]/g, '').trim()) throw new Error('이 PDF 에는 글자 층이 없습니다(스캔·그림 PDF). 글자를 복사해 「글자 붙여 넣기」로 넣어 주세요.');
        return { text: text, pages: pages.length, format: 'pdf' };
      });
    });
  }
  function docxText(buf) {
    if (!root.JSZip) return Promise.reject(new Error('DOCX 읽기 도구(vendor/jszip.min.js)를 불러오지 못했습니다.'));
    return root.JSZip.loadAsync(buf).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw new Error('Word(.docx) 파일 안에서 본문(word/document.xml)을 찾지 못했습니다.');
      return f.async('string');
    }).then(function (xml) { return { text: L.docxXmlToText(xml), pages: null, format: 'docx' }; });
  }
  function plainText(buf) {
    var t = new TextDecoder('utf-8').decode(buf);
    if ((t.match(/�/g) || []).length > 3) { try { t = new TextDecoder('euc-kr').decode(buf); } catch (e) { /* 그대로 */ } }
    return { text: t.replace(/^﻿/, ''), pages: null, format: 'txt' };
  }
  function readDocFile(file) {
    var name = file.name || '', ext = (/\.([^.]+)$/.exec(name) || [])[1];
    ext = ext ? ext.toLowerCase() : '';
    if (ext === 'hwp' || ext === 'hwpx') return Promise.reject(new Error(name + ': 한글(HWP) 파일은 바로 읽지 못합니다. PDF 나 Word(.docx)로 저장해 넣어 주세요.'));
    if (['pdf', 'docx', 'txt', 'md', 'markdown', 'csv'].indexOf(ext) < 0) return Promise.reject(new Error(name + ': PDF · Word(.docx) · 글자(.txt·.md) 파일만 넣을 수 있습니다.'));
    return readBuf(file).then(function (buf) {
      if (ext === 'pdf') return pdfText(buf);
      if (ext === 'docx') return docxText(buf);
      return plainText(buf);
    }).then(function (r) { r.fileName = name; if (ext === 'md' || ext === 'markdown') r.format = 'md'; return r; }, function (e) {
      throw new Error(e.message.indexOf(name) === 0 ? e.message : name + ': ' + e.message);
    });
  }
  root.RegReaders = { readDocFile: readDocFile };
})(window);
