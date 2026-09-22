import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownText } from '../../src/components/chat/MarkdownText'

test('chat markdown renders common GFM blocks without flattening them', () => {
  const content = '###### 小标题\n\n**粗体** *斜体* ~~删除~~ `代码` [链接](https://example.com)\n\n> 引用\n\n1. 第一\n2. 第二\n\n- [x] 做完\n- [ ] 待办\n\n| 名称 | 数量 |\n| :--- | ---: |\n| 星星 | 2 |\n\n---\n\n```ts\nconst n = 2\n```'
  const html = renderToStaticMarkup(React.createElement(MarkdownText, { content }))

  assert.match(html, /aria-level="6"/)
  assert.match(html, /<strong>粗体<\/strong>/)
  assert.match(html, /<em>斜体<\/em>/)
  assert.match(html, /<del>删除<\/del>/)
  assert.match(html, /<a[^>]*href="https:\/\/example.com"/)
  assert.match(html, /<blockquote/)
  assert.match(html, /<ol/)
  assert.match(html, /type="checkbox"[^>]*checked/)
  assert.match(html, /<table/)
  assert.match(html, /text-align:right/)
  assert.match(html, /<td[^>]*>星星<\/td>/)
  assert.match(html, /<hr/)
  assert.match(html, /<pre/)
  assert.match(html, /data-language="ts"/)
})
