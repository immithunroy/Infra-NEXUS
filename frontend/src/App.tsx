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

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}