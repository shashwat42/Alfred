import Chat from "./components/Chat";
import Dashboard from "./components/Dashboard";
import Header from "./components/Header"

const App = () => {
  return <div className="App">
    <Header />
    <main className="Main">
      <Chat />
      <Dashboard />
    </main>
  </div>

}

export default App;
