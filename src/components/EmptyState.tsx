import { DevicesOutlined } from "@mui/icons-material";
import { Box, Button, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, description, action, onAction }: EmptyStateProps) {
  return (
    <Box sx={{ minHeight: 360, display: "grid", placeItems: "center", textAlign: "center" }}>
      <Box sx={{ maxWidth: 420 }}>
        <Box sx={{ color: "#7b8085", mb: 1.5, "& svg": { fontSize: 44 } }}>{icon ?? <DevicesOutlined />}</Box>
        <Typography variant="h2" sx={{ mb: 0.75 }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: action ? 2 : 0 }}>
          {description}
        </Typography>
        {action && <Button onClick={onAction}>{action}</Button>}
      </Box>
    </Box>
  );
}
