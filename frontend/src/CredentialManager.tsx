import { useState } from "react";
import type { Credential } from "./types";

type CredentialManagerProps = {
  credentials: Credential[];
  onCreate: (input: {
    name: string;
    connector_type: string;
    config: Record<string, unknown>;
    env_vars: Record<string, string>;
  }) => Promise<void>;
};

export function CredentialManager({ credentials, onCreate }: CredentialManagerProps) {
  const [name, setName] = useState("PROD_RABBITMQ");
  const [connectorType, setConnectorType] = useState("rabbitmq");
  const [url, setUrl] = useState("amqp://user:${PASSWORD}@host:5672/");
  const [password, setPassword] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onCreate({
      name,
      connector_type: connectorType,
      config: { url },
      env_vars: password ? { PASSWORD: password } : {}
    });
  }

  return (
    <section className="credential-manager">
      <div className="section-heading">
        <span>Credential Library</span>
        <h2>Global credentials</h2>
      </div>
      <div className="credential-list">
        {credentials.map((credential) => (
          <article className="credential-row" key={credential.id}>
            <strong>{credential.name}</strong>
            <span>{credential.connector_type}</span>
            <code>{Object.keys(credential.env_vars).join(", ") || "no env vars"}</code>
          </article>
        ))}
      </div>
      <form className="credential-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="field">
          <span>Type</span>
          <select onChange={(event) => setConnectorType(event.target.value)} value={connectorType}>
            <option value="mysql">mysql</option>
            <option value="rabbitmq">rabbitmq</option>
            <option value="redis">redis</option>
            <option value="sqs">sqs</option>
            <option value="feishu_bitable">feishu_bitable</option>
          </select>
        </label>
        <label className="field span-2">
          <span>URL / DSN</span>
          <input onChange={(event) => setUrl(event.target.value)} value={url} />
        </label>
        <label className="field">
          <span>PASSWORD</span>
          <input onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        <button className="primary-button" type="submit">
          Add Credential
        </button>
      </form>
    </section>
  );
}

