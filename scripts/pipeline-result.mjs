/** Publishing must preserve the collection outcome, including partial/failed runs. */
export async function finishPipeline(summary, { publish, report }) {
  await report('running', { ...summary, state: 'running' })
  let published = false
  try {
    if (summary.state === 'success' || summary.state === 'partial' && summary.added + summary.refreshed + summary.repaired > 0) {
      published = await publish()
    }
  } catch {
    await report('failed', { ...summary, state: 'failed', published: false, finishedAt: Date.now(),
      message: summary.message + '；发布失败，本机采集结果已保留，请检查发布连接或凭证后重试' }, true)
    return 'failed'
  }
  await report(summary.state, { ...summary, published, finishedAt: Date.now(),
    message: summary.message + '；' + (published ? 'R2已发布' : '未发布') }, true)
  return summary.state
}
