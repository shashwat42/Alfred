import Mic from "../assets/Mic_Icon.png"

export default function Chat() {
    return <section className="Chat">
        <img src={Mic}></img>
        <p>Ask anything / Schedule a meeting!</p>
        <input aria-label="Ask" placeholder="Ask Alfred anything.."></input>
    </section>
}
