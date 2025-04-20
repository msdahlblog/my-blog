const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');

// Configuration from environment variables
const config = {
  email: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.EMAIL_HOST || 'imap.gmail.com',
    port: process.env.EMAIL_PORT || 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  },
  allowedSenders: (process.env.ALLOWED_SENDERS || '').split(','),
  contentDir: 'content/posts'
};

// Ensure content directory exists
if (!fs.existsSync(config.contentDir)) {
  fs.mkdirSync(config.contentDir, { recursive: true });
}

// Convert email to Hugo markdown
function emailToHugoMarkdown(email) {
  // Extract information from email
  const { subject, from, text, html } = email;
  const senderEmail = from.value[0].address;
  
  // Check if sender is allowed
  if (config.allowedSenders.length > 0 && 
      !config.allowedSenders.includes(senderEmail)) {
    console.log(`Skipping email from unauthorized sender: ${senderEmail}`);
    return null;
  }

  // Create slug from subject
  const date = new Date();
  const formattedDate = date.toISOString().split('T')[0];
  const slug = slugify(subject, { lower: true, strict: true });
  const filename = `${formattedDate}-${slug}.md`;

  // Extract tags from email subject (using hashtags)
  const tags = (subject.match(/#[a-zA-Z0-9]+/g) || [])
    .map(tag => tag.substring(1))
    .filter(tag => tag.length > 0);

  // Remove hashtags from title
  const title = subject.replace(/#[a-zA-Z0-9]+/g, '').trim();
  
  // Get sender name
  const senderName = from.value[0].name || senderEmail.split('@')[0];

  // Use text content if available, otherwise try to extract from HTML
  const content = text || (html ? html.replace(/<[^>]*>/g, '') : '');

  // Create front matter
  const frontMatter = `---
title: "${title}"
date: ${date.toISOString()}
draft: false
author: "${senderName}"
tags: [${tags.map(tag => `"${tag}"`).join(', ')}]
---

`;

  // Combine front matter and body
  return {
    content: frontMatter + content,
    filename,
    path: path.join(config.contentDir, filename)
  };
}

// Connect to email server and check for new messages
function checkEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(config.email);
    
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }
        
        // Search for unread emails
        imap.search(['UNSEEN'], (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }
          
          if (results.length === 0) {
            console.log('No new emails found');
            imap.end();
            return resolve([]);
          }
          
          console.log(`Found ${results.length} new emails`);
          
          const processingPromises = [];
          const f = imap.fetch(results, { bodies: [''], markSeen: true });
          
          f.on('message', (msg, seqno) => {
            const emailPromise = new Promise((resolveEmail) => {
              msg.on('body', (stream, info) => {
                let buffer = '';
                
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                
                stream.on('end', () => {
                  // Parse the email
                  simpleParser(buffer, (err, mail) => {
                    if (err) {
                      console.error('Error parsing email:', err);
                      resolveEmail(null);
                      return;
                    }
                    
                    // Convert to Hugo markdown
                    const post = emailToHugoMarkdown(mail);
                    resolveEmail(post);
                  });
                });
              });
            });
            
            processingPromises.push(emailPromise);
          });
          
          f.once('error', (err) => {
            console.error('Fetch error:', err);
            imap.end();
            reject(err);
          });
          
          f.once('end', () => {
            Promise.all(processingPromises)
              .then((posts) => {
                imap.end();
                resolve(posts.filter(Boolean)); // Remove null entries
              })
              .catch((err) => {
                imap.end();
                reject(err);
              });
          });
        });
      });
    });
    
    imap.once('error', (err) => {
      console.error('IMAP error:', err);
      reject(err);
    });
    
    imap.once('end', () => {
      console.log('IMAP connection ended');
    });
    
    imap.connect();
  });
}

// Main function
async function main() {
  try {
    const posts = await checkEmails();
    
    if (posts.length === 0) {
      console.log('No new posts to create');
      return;
    }
    
    console.log(`Creating ${posts.length} new posts...`);
    
    // Write each post to a file
    posts.forEach((post) => {
      fs.writeFileSync(post.path, post.content);
      console.log(`Created: ${post.filename}`);
    });
    
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the main function
main();
