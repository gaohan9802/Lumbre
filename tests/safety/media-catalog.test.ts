import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDoubanBookHtml, parseDoubanBookUrl, parseDoubanCoverUrl } from '../../src/server/media-catalog'

test('Douban book import accepts only subject URLs and extracts editable metadata', () => {
  assert.throws(() => parseDoubanBookUrl('https://example.com/subject/1061118/'))
  assert.throws(() => parseDoubanBookUrl('http://book.douban.com/subject/1061118/'))
  assert.throws(() => parseDoubanCoverUrl('https://example.com/view/subject/l/public/cover.jpg'))
  assert.equal(parseDoubanCoverUrl('https://img3.doubanio.com/view/subject/l/public/cover.jpg').hostname, 'img3.doubanio.com')
  assert.equal(parseDoubanBookUrl('https://book.douban.com/subject/1061118/?from=foo').url.toString(), 'https://book.douban.com/subject/1061118/')

  const item = parseDoubanBookHtml(`
    <script type="application/ld+json">{"@type":"Book","name":"活着","author":[{"name":"余华"}],"isbn":"9787532125944"}</script>
    <meta property="og:image" content="https://img3.doubanio.com/view/subject/l/public/s1469173.jpg" />
    <div id="info"><span class="pl">出版社:</span> 上海文艺出版社<br><span class="pl">出版年:</span> 2004-5<br><span class="pl">页数:</span> 194<br></div>
    <div id="link-report"><div class="intro"><p>一段完整简介。</p></div></div>
  `, '1061118')
  assert.deepEqual({ title: item.title, creators: item.creators, publisher: item.publisher, published: item.published_date, pages: item.page_count, isbn: item.isbn }, {
    title: '活着', creators: ['余华'], publisher: '上海文艺出版社', published: '2004-5', pages: 194, isbn: '9787532125944',
  })
  assert.equal(item.summary, '一段完整简介。')
})
