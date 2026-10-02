import { AuthForm } from "@/components/ui/auth-form";

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span> SAFSight</div>
        <h1 id="auth-title">Create your account</h1>
        <p className="auth-intro">Set up your personal sign-in for SAFSight.</p>
        <AuthForm mode="register" />
        <p className="auth-switch">Already registered? <a href="/login">Sign in</a></p>
      </section>
    </main>
  );
}