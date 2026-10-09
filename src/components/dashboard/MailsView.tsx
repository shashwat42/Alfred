import mailIcon from "../../assets/mail.png";

export function MailsView() {
    return (
        <div className="mails-placeholder-view">
            <img src={mailIcon} alt="" className="mails-placeholder-icon" />
            <h3 className="mails-placeholder-title">Mails Integration</h3>
            <p className="mails-placeholder-subtext">
                Email accounts and notifications will be available here soon.
            </p>
        </div>
    );
}
