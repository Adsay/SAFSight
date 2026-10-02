import { AuthForm } from "@/components/ui/auth-form";

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</div>
        <h1 id="auth-title">Welcome back</h1>
        <p className="auth-intro">Sign in to continue to your workspace.</p>
        <AuthForm mode="login" />
        <p className="auth-switch">New to SAFSight? <a href="/register">Create an account</a></p>
      </section>
    </main>
  );
}