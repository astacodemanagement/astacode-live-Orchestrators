// Pakai di halaman React mana pun: <VirtualOffice />
// Kantor disajikan Laravel dari public/office/index.html dan membaca event dari /api/office.
export default function VirtualOffice({ api = "/api/office", height = "100vh" }) {
  return (
    <iframe
      title="Astacode Agent Office"
      src={`/office/index.html?api=${encodeURIComponent(api)}`}
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
