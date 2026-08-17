/**
 * A real `sleep` data point, captured from a live Fitbit-sourced account on
 * 2026-08-17 and trimmed only of the account id in `name`.
 *
 * This exists because the first version of the sleep parser was written against
 * the proto reference at developers.google.com, whose field names do **not**
 * match the REST JSON: `sleep_stages[].stage_type = "SLEEP_STAGE_DEEP"` there
 * versus `stages[].type = "DEEP"` here, `sleepSummary.stageSummaries[].duration`
 * ("3060s") versus `summary.stagesSummary[].minutes` ("51"), and the session
 * interval nested under `interval` rather than sitting at the top level. Every
 * field read missed, so every night rendered as "0 min asleep".
 *
 * Tests assert against the numbers this night actually contains. Do not tidy
 * the values -- the point is that they came off the wire.
 */
export const FITBIT_SLEEP_NIGHT = {
  name: 'users/0000000000000000000/dataTypes/sleep/dataPoints/316341285201410536',
  dataSource: {
    recordingMethod: 'DERIVED',
    device: {},
    platform: 'FITBIT',
  },
  sleep: {
    interval: {
      startTime: '2026-08-16T20:18:00Z',
      startUtcOffset: '7200s',
      endTime: '2026-08-17T04:16:00Z',
      endUtcOffset: '7200s',
    },
    type: 'STAGES',
    stages: [
      { startTime: '2026-08-16T20:18:00Z', endTime: '2026-08-16T20:25:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T20:25:00Z', endTime: '2026-08-16T20:36:00Z', type: 'LIGHT' },
      { startTime: '2026-08-16T20:36:00Z', endTime: '2026-08-16T20:54:30Z', type: 'DEEP' },
      { startTime: '2026-08-16T20:54:30Z', endTime: '2026-08-16T20:59:30Z', type: 'LIGHT' },
      { startTime: '2026-08-16T20:59:30Z', endTime: '2026-08-16T21:04:00Z', type: 'DEEP' },
      { startTime: '2026-08-16T21:04:00Z', endTime: '2026-08-16T21:14:00Z', type: 'LIGHT' },
      { startTime: '2026-08-16T21:14:00Z', endTime: '2026-08-16T21:32:30Z', type: 'REM' },
      { startTime: '2026-08-16T21:32:30Z', endTime: '2026-08-16T22:37:00Z', type: 'LIGHT' },
      { startTime: '2026-08-16T22:37:00Z', endTime: '2026-08-16T22:43:30Z', type: 'REM' },
      { startTime: '2026-08-16T22:43:30Z', endTime: '2026-08-16T23:06:30Z', type: 'LIGHT' },
      { startTime: '2026-08-16T23:06:30Z', endTime: '2026-08-16T23:25:30Z', type: 'DEEP' },
      { startTime: '2026-08-16T23:25:30Z', endTime: '2026-08-16T23:46:30Z', type: 'LIGHT' },
      { startTime: '2026-08-16T23:46:30Z', endTime: '2026-08-17T00:15:00Z', type: 'REM' },
      { startTime: '2026-08-17T00:15:00Z', endTime: '2026-08-17T01:06:00Z', type: 'LIGHT' },
      { startTime: '2026-08-17T01:06:00Z', endTime: '2026-08-17T01:11:00Z', type: 'DEEP' },
      { startTime: '2026-08-17T01:11:00Z', endTime: '2026-08-17T01:12:30Z', type: 'LIGHT' },
      { startTime: '2026-08-17T01:12:30Z', endTime: '2026-08-17T01:17:00Z', type: 'DEEP' },
      { startTime: '2026-08-17T01:17:00Z', endTime: '2026-08-17T01:25:30Z', type: 'LIGHT' },
      { startTime: '2026-08-17T01:25:30Z', endTime: '2026-08-17T01:46:30Z', type: 'REM' },
      { startTime: '2026-08-17T01:46:30Z', endTime: '2026-08-17T02:53:00Z', type: 'LIGHT' },
      { startTime: '2026-08-17T02:53:00Z', endTime: '2026-08-17T03:26:30Z', type: 'REM' },
      { startTime: '2026-08-17T03:26:30Z', endTime: '2026-08-17T04:13:00Z', type: 'LIGHT' },
      { startTime: '2026-08-17T04:13:00Z', endTime: '2026-08-17T04:16:00Z', type: 'AWAKE' },
    ],
    metadata: {
      stagesStatus: 'SUCCEEDED',
      processed: true,
      mainSleep: true,
    },
    summary: {
      minutesInSleepPeriod: '478',
      minutesAfterWakeUp: '0',
      minutesToFallAsleep: '0',
      minutesAsleep: '468',
      minutesAwake: '10',
      stagesSummary: [
        { type: 'AWAKE', minutes: '10', count: '2' },
        { type: 'LIGHT', minutes: '308', count: '11' },
        { type: 'DEEP', minutes: '51', count: '5' },
        { type: 'REM', minutes: '108', count: '5' },
      ],
    },
    createTime: '2026-08-16T20:56:33.274543Z',
    updateTime: '2026-08-17T04:27:50.189279Z',
    // 22 brief arousals, tracked separately from the stage timeline. This is
    // the closest thing the payload has to the Sleep Score's "restlessness".
    shortAwakenings: [
      { startTime: '2026-08-16T20:28:30Z', endTime: '2026-08-16T20:29:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T21:05:00Z', endTime: '2026-08-16T21:06:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T21:35:30Z', endTime: '2026-08-16T21:37:30Z', type: 'AWAKE' },
      { startTime: '2026-08-16T21:55:30Z', endTime: '2026-08-16T21:56:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T22:23:00Z', endTime: '2026-08-16T22:23:30Z', type: 'AWAKE' },
      { startTime: '2026-08-16T22:30:00Z', endTime: '2026-08-16T22:30:30Z', type: 'AWAKE' },
      { startTime: '2026-08-16T22:33:00Z', endTime: '2026-08-16T22:34:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T22:43:30Z', endTime: '2026-08-16T22:44:00Z', type: 'AWAKE' },
      { startTime: '2026-08-16T23:25:30Z', endTime: '2026-08-16T23:26:30Z', type: 'AWAKE' },
      { startTime: '2026-08-16T23:30:00Z', endTime: '2026-08-16T23:30:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T00:15:00Z', endTime: '2026-08-17T00:15:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T00:22:00Z', endTime: '2026-08-17T00:22:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T00:44:00Z', endTime: '2026-08-17T00:44:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T00:51:30Z', endTime: '2026-08-17T00:52:00Z', type: 'AWAKE' },
      { startTime: '2026-08-17T01:17:00Z', endTime: '2026-08-17T01:17:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:00:30Z', endTime: '2026-08-17T02:01:00Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:14:30Z', endTime: '2026-08-17T02:15:00Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:16:30Z', endTime: '2026-08-17T02:17:00Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:22:00Z', endTime: '2026-08-17T02:23:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:43:00Z', endTime: '2026-08-17T02:44:00Z', type: 'AWAKE' },
      { startTime: '2026-08-17T02:51:00Z', endTime: '2026-08-17T02:51:30Z', type: 'AWAKE' },
      { startTime: '2026-08-17T03:59:00Z', endTime: '2026-08-17T04:00:30Z', type: 'AWAKE' },
    ],
  },
}
