import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { choose, continueCampaign, createCampaign, currentPayload } from '../../src/server/detroit/engine'

const FIRST_CHOICE_ENDINGS = [
  'ending_snipers_shot', 'ending_kara_arrived_home', 'ending_markus_took_bus', 'ending_chores_complete',
  'ending_the_painter', 'ending_deviant_found', 'ending_evaded_window', 'ending_obeyed_carl',
  'ending_android_sent_to_cell', 'ending_motel', 'ending_from_the_dead', 'ending_got_lead',
  'ending_train_safe', 'ending_jericho', 'ending_saved_hank', 'ending_time_to_decide',
  'ending_escape_monsters', 'ending_leave_for_eden_club', 'ending_returned_bags', 'ending_deviants_spared',
  'ending_quiet_night', 'ending_hank_placated', 'ending_escaped', 'ending_deviant_self_destructed',
  'ending_cop_leaves', 'ending_violent_overridden', 'ending_shot_chloe', 'ending_fled',
  'ending_eluded_perkins', 'ending_kara_escaped_luther_sacrifice', 'ending_violent_attack', 'ending_kara_arrested',
]

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

test('底特律固定首选路线与上游 runner 的完整 32 章结果一致', () => {
  const game = createCampaign('casual')
  let choices = 0
  let guard = 0
  while (game.status !== 'complete') {
    assert.ok(guard++ < 400, 'campaign should finish')
    if (game.status === 'between_chapters') {
      continueCampaign(game)
      continue
    }
    const scene = game.active?.current
    assert.ok(scene)
    const selected = scene.choices[0]
    choose(game, game.active!.chapter_id, scene.node_id, selected.id, '固定测试路线', () => 0)
    choices += 1
  }
  assert.equal(game.completed_chapters.length, 32)
  assert.equal(choices, 167)
  assert.deepEqual(game.completed_chapters.map(chapter => chapter.ending.id), FIRST_CHOICE_ENDINGS)
  assert.equal(createHash('sha256').update(stableJson(game.cross_chapter_state)).digest('hex'), '73d656831629e24c9521fb27d83b6994b1c765485653b6b2c000e5d69a7a0340')
  assert.equal(currentPayload(game).status, 'campaign_complete')
})

test('底特律重复提交同一场景选择只返回去重结果', () => {
  const game = createCampaign('casual')
  const scene = game.active!.current!
  const selected = scene.choices[0]
  assert.equal(choose(game, game.active!.chapter_id, scene.node_id, selected.id, '第一次', () => 0), false)
  assert.equal(choose(game, game.active!.chapter_id, scene.node_id, selected.id, '重复', () => 0), true)
  assert.equal(game.active!.decisions.filter(decision => decision.node_id === scene.node_id).length, 1)
})
