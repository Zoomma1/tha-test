import { Link, Route, Routes } from "react-router-dom";
import { SessionBar } from "./components/SessionBar";
import { Builds } from "./pages/Builds";
import { Inventory } from "./pages/Inventory";
import { Login } from "./pages/Login";
import { PartDetail } from "./pages/PartDetail";
import { Parts } from "./pages/Parts";
import { Wishlist } from "./pages/Wishlist";

export function App() {
  return (
    <main>
      <nav>
        <Link to="/">Parts</Link> <Link to="/inventory">Inventory</Link> <Link to="/builds">Builds</Link>{" "}
        <Link to="/wishlist">Wishlist</Link> <SessionBar />
      </nav>
      <Routes>
        <Route path="/" element={<Parts />} />
        <Route path="/parts/:id" element={<PartDetail />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/builds" element={<Builds />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<p>Page introuvable.</p>} />
      </Routes>
    </main>
  );
}
