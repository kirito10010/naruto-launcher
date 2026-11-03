// flash-quality-medium-preload.js
// 在游戏页创建 Flash embed 之前，把 quality 参数改成 medium。
// 必须在页面脚本执行前改写 HTML，挂载后再改属性对 Flash 不保证生效。
(function () {
  var QUALITY = 'medium';

  function fixHtml(html) {
    if (typeof html !== 'string' || !/quality/i.test(html)) return html;
    try {
      html = html.replace(/quality\s*=\s*"(?:low|autolow|autohigh|medium|high|best)"/gi, 'quality="' + QUALITY + '"');
      html = html.replace(/quality\s*=\s*'(?:low|autolow|autohigh|medium|high|best)'/gi, "quality='" + QUALITY + "'");
      html = html.replace(/(<param\s+name=["']quality["']\s+value=["'])(?:low|autolow|autohigh|medium|high|best)(["'])/gi, '$1' + QUALITY + '$2');
    } catch (e) { /* ignore */ }
    return html;
  }

  function patchHtmlSetter(proto, prop) {
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (value) {
          return desc.set.call(this, fixHtml(value));
        }
      });
    } catch (e) { /* ignore */ }
  }

  patchHtmlSetter(Element.prototype, 'innerHTML');
  patchHtmlSetter(Element.prototype, 'outerHTML');

  // 有些页面用 DOM API 创建 embed 后 setAttribute('quality', 'high')
  try {
    var origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      try {
        var tag = this.tagName;
        if (String(name).toLowerCase() === 'quality' && (tag === 'EMBED' || tag === 'OBJECT')) {
          value = QUALITY;
        }
      } catch (e) { /* ignore */ }
      return origSetAttribute.call(this, name, value);
    };
  } catch (e) { /* ignore */ }

  // 兼容 document.write 直接输出 object/embed 标记的页面
  try {
    var origWrite = Document.prototype.write;
    var origWriteln = Document.prototype.writeln;
    Document.prototype.write = function () {
      var args = Array.prototype.slice.call(arguments).map(fixHtml);
      return origWrite.apply(this, args);
    };
    Document.prototype.writeln = function () {
      var args = Array.prototype.slice.call(arguments).map(fixHtml);
      return origWriteln.apply(this, args);
    };
  } catch (e) { /* ignore */ }

  try {
    var origInsert = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      return origInsert.call(this, position, fixHtml(html));
    };
  } catch (e) { /* ignore */ }
})();
