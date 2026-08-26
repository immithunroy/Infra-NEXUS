import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./api/client";
import Layout from "./components/Layout";
import { ThemeProvider } from "./theme";
import Acs from "./pages/Acs";
import Bindings from "./pages/Bindings";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import FiberMap from "./pages/FiberMap";
import LiveDowns from "./pages/LiveDowns";
import Login from "./pages/Login";
import NetworkMap from "./pages/NetworkMap";
import Onus from "./pages/Onus";
import OnuProfile from "./pages/OnuProfile";
import Reports from "./pages/Reports";
import Scans from "./pages/Scans";
import SubscriberProfile from "./pages/SubscriberProfile";
import Subscribers from "./pages/Subscribers";
import Tickets from "./pages/Tickets";
import Users from "./pages/Users";
import { Component, ErrorInfo, ReactNode } from "react";

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("CRASH:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, background: "#fff", color: "#000", fontFamily: "monospace", minHeight: "100vh" }}>
          <h1 style={{ color: "red", fontSize: 24 }}>APP CRASH</h1>
          <p style={{ fontSize: 18 }}>{this.state.error.message}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 16 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/devices" element={<Devices />} />
            <Route path="/onus" element={<Onus />} />
            <Route path="/onus/:id" element={<OnuProfile />} />
            <Route path="/bindings" element={<Bindings />} />
            <Route path="/subscribers" element={<Subscribers />} />
            <Route path="/subscribers/:subscriber" element={<SubscriberProfile />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/acs" element={<Acs />} />
            <Route path="/live-downs" element={<LiveDowns />} />
            <Route path="/network-map" element={<NetworkMap />} />
            <Route path="/fiber-map" element={<FiberMap />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/users" element={<Users />} />
            <Route path="/scans" element={<Scans />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
