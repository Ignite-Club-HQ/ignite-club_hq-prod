interface GoogleMapEmbedProps {
  address: string;
  className?: string;
}

export function GoogleMapEmbed({
  address,
  className = "w-full h-48 rounded-lg",
}: GoogleMapEmbedProps) {
  const encodedAddress = encodeURIComponent(address);

  if (!address) {
    return null;
  }

  return (
    <iframe
      className={className}
      src={`https://www.google.com/maps?q=${encodedAddress}&output=embed`}
      allowFullScreen
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      title="Event location map"
    />
  );
}
