import { useGoogleData } from '../state/googleData'
import {
  GOOGLE_TAB_IDS,
  GOOGLE_TAB_LABELS,
  useGoogleTabState,
  type GoogleTabId,
} from '../state/tabs'
import Controls from './Controls'
import ExerciseSection from './ExerciseSection'
import NutritionSection from './NutritionSection'
import OutcomeSummary from './OutcomeSummary'
import ProfileSection from './ProfileSection'
import RecordList from './RecordList'
import SleepSection from './SleepSection'
import Tabs, { tabButtonId, tabPanelId, type TabItem } from './Tabs'

const PANEL_PREFIX = 'google'

/**
 * The Google tab. Controls and fetch outcomes sit above the sub-tabs because
 * they govern both views — the data-type selection and time range decide what
 * either one has to work with, so putting them inside a sub-tab would imply
 * they only apply there.
 */
export default function Dashboard() {
  const {
    controls,
    setControls,
    visible,
    nights,
    sessions,
    nutrition,
    outcomes,
    loading,
    error,
    loadedAt,
    reload,
  } = useGoogleData()
  const [tab, setTab] = useGoogleTabState()

  // Profile has no badge: the other three count rows the controls just fetched,
  // and a "1" beside a single object that is always there would be noise.
  const badges: Partial<Record<GoogleTabId, string>> = {
    sleep: String(nights.length),
    exercise: String(sessions.length),
    nutrition: String(nutrition.length),
    activity: String(visible.length),
  }

  const items: Array<TabItem<GoogleTabId>> = GOOGLE_TAB_IDS.map((id) => ({
    id,
    label: GOOGLE_TAB_LABELS[id],
    badge: badges[id],
  }))

  return (
    <>
      <Controls state={controls} onChange={setControls} onRefresh={reload} loading={loading} />

      {error && <p className="banner banner-error">{error}</p>}
      <OutcomeSummary outcomes={outcomes} />

      <Tabs
        items={items}
        active={tab}
        onChange={setTab}
        label="Google Health view"
        idPrefix={PANEL_PREFIX}
        variant="sub"
      />

      <div
        className="tab-panel tab-panel-sub"
        id={tabPanelId(PANEL_PREFIX, tab)}
        role="tabpanel"
        aria-labelledby={tabButtonId(PANEL_PREFIX, tab)}
        tabIndex={-1}
      >
        {tab === 'sleep' ? (
          <SleepSection />
        ) : tab === 'exercise' ? (
          <ExerciseSection />
        ) : tab === 'nutrition' ? (
          <NutritionSection />
        ) : tab === 'profile' ? (
          <ProfileSection />
        ) : (
          <>
            <div className="list-header">
              <h2>All activity</h2>
              <span className="muted">
                {visible.length} {visible.length === 1 ? 'record' : 'records'}
                {loadedAt && ` · updated ${loadedAt.toLocaleTimeString()}`}
              </span>
            </div>
            <RecordList records={visible} loading={loading} />
          </>
        )}
      </div>
    </>
  )
}
