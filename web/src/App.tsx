import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/auth';
import { useTheme } from './state/theme';
import { AppShell } from './components/AppShell';
import { LockScreen, LoginScreen, SetupScreen, SplashScreen } from './pages/AuthScreens';
import { Spinner } from './components/ui/primitives';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Today = React.lazy(() => import('./pages/Today'));
const Tasks = React.lazy(() => import('./pages/Tasks'));
const Calendar = React.lazy(() => import('./pages/Calendar'));
const Projects = React.lazy(() => import('./pages/Projects'));
const Goals = React.lazy(() => import('./pages/Goals'));
const Habits = React.lazy(() => import('./pages/Habits'));
const FocusPage = React.lazy(() => import('./pages/Focus'));
const Progress = React.lazy(() => import('./pages/Progress'));
const Analytics = React.lazy(() => import('./pages/Analytics'));
const Reviews = React.lazy(() => import('./pages/Reviews'));
const History = React.lazy(() => import('./pages/History'));
const Notes = React.lazy(() => import('./pages/Notes'));
const Settings = React.lazy(() => import('./pages/Settings'));

function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  );
}

export default function App() {
  const { status, user } = useAuth();
  const { setMode, setAccent } = useTheme();

  // The server is the source of truth for theme once you are signed in, so the
  // same preference follows you between your laptop and your phone.
  React.useEffect(() => {
    if (user) {
      setMode(user.theme);
      setAccent(user.accent || 'indigo');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.theme, user?.accent]);

  if (status === 'loading') return <SplashScreen />;
  if (status === 'setup') return <SetupScreen />;
  if (status === 'signed-out') return <LoginScreen />;
  if (status === 'locked') return <LockScreen />;

  return (
    <AppShell>
      <React.Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/today" element={<Today />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<Projects />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/focus" element={<FocusPage />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:date" element={<History />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </React.Suspense>
    </AppShell>
  );
}
