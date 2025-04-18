name: Email to Blog Post

on:
  schedule:
    - cron: '*/30 * * * *'  # Run every 30 minutes
  workflow_dispatch:  # Allow manual trigger

jobs:
  check-email-and-post:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3
        
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '16'
          
      - name: Install dependencies
        run: npm install imap simple-mail-parser slugify

      - name: Check email and create posts
        run: node .github/scripts/email-to-post.js
        env:
          EMAIL_USER: ${{ secrets.EMAIL_USER }}
          EMAIL_PASSWORD: ${{ secrets.EMAIL_PASSWORD }}
          EMAIL_HOST: ${{ secrets.EMAIL_HOST }}
          EMAIL_PORT: ${{ secrets.EMAIL_PORT }}
          ALLOWED_SENDERS: ${{ secrets.ALLOWED_SENDERS }}
          
      - name: Commit and push if there are changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add content/posts/
          git diff --quiet && git diff --staged --quiet || (git commit -m "Add new post from email" && git push)
