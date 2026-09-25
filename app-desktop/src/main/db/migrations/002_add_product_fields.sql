-- Add category/description and supplier fields to products
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN supplier TEXT;
