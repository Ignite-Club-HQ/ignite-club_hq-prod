const Index = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-foreground">Ignite Club HQ</h1>
        <p className="text-lg text-muted-foreground">Ready for setup</p>
        <div className="flex flex-col gap-2 pt-4 text-sm text-muted-foreground">
          <p>→ Connect GitHub repository</p>
          <p>→ Connect Supabase instance</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
