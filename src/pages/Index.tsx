const Index = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="text-center max-w-lg">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <svg
            className="h-8 w-8 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
          Ready to Build
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Connect your Supabase project and sync with GitHub to start building.
        </p>
      </div>
    </div>
  );
};

export default Index;
